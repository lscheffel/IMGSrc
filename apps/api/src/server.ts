import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import cors from 'cors';
import express from 'express';
import { z } from 'zod';

import { clearHistory, exportHistoryCsv, listHistoryPage } from './db.js';
import { rateLimitMiddleware, resetAllRateLimits } from './middleware/rateLimit.js';
import { downloadImages } from './services/downloader.js';
import { scrapeGalleries } from './services/scraper.js';
import { getRateLimiter } from './middleware/rateLimit.js';
import {
  calculateThroughput,
  getMetricsSnapshot,
  observeHttpMetric,
  processRateLimitStats
} from './telemetry/metrics.js';
import {
  enqueueDownloadJob,
  getDownloadJob,
  getQueueStats,
  listDownloadJobs
} from './workers/downloadQueue.js';
import {
  enqueueScrapeJob,
  getScrapeJob,
  getScrapeQueueStats,
  listScrapeJobs
} from './workers/scrapeJobs.js';
import { createScraperPool, createDownloadPool } from './workers/workerPool.js';
import type { ScrapedImage, ScrapeResponse, DownloadResponse } from './types.js';

const scrapeSchema = z.object({
  urls: z.array(z.string().min(1)).min(1),
  minSizeKb: z.number().int().min(1).default(10),
  scrapeThreads: z.number().int().min(1).max(10).default(2),
  urlWorkers: z.number().int().min(1).max(16).default(6)
});

const imageSchema = z.object({
  url: z.string().url(),
  size: z.number().int().min(0),
  user: z.string().min(1),
  title: z.string().min(1)
});

const downloadSchema = z.object({
  images: z.array(imageSchema),
  destFolder: z.string().min(1),
  overwrite: z.boolean().default(false),
  createUserFolder: z.boolean().default(true),
  createAlbumFolder: z.boolean().default(true),
  downloadsParallel: z.number().int().min(1).max(48).default(16)
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(60),
  cursor: z.coerce.number().int().positive().optional()
});

export function createServer() {
  const app = express();

  // Initialize worker pools
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const scraperPool = createScraperPool(join(currentDir, 'workers/scraperWorker.ts'));
  const downloadPool = createDownloadPool(join(currentDir, 'workers/downloadWorker.ts'));

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    const startedAt = performance.now();
    res.on('finish', () => {
      const routePath =
        typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : req.path;
      observeHttpMetric({
        method: req.method,
        route: routePath,
        statusCode: res.statusCode,
        durationMs: performance.now() - startedAt
      });
    });
    next();
  });

  // Rate-limit middleware applied only to routes that make external requests
  app.use(rateLimitMiddleware());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/scrape', async (req, res) => {
    const parsed = scrapeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten()
      });
      return;
    }

    try {
      // Usar worker pool para scraping assíncrono
      const response = await scraperPool.postMessage<unknown, ScrapeResponse>(
        'SCRAPE_TASK',
        parsed.data
      );

      if (!response.success) {
        throw new Error(response.error?.message ?? 'scrape_failed');
      }

      res.json(response.payload);
    } catch (error) {
      res.status(500).json({
        error: 'scrape_failed',
        details: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  });

  app.post('/api/download', async (req, res) => {
    const parsed = downloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten()
      });
      return;
    }

    try {
      // Usar worker pool para download assíncrono
      const response = await downloadPool.postMessage<unknown, DownloadResponse>(
        'DOWNLOAD_TASK',
        parsed.data
      );

      if (!response.success) {
        throw new Error(response.error?.message ?? 'download_failed');
      }

      res.json(response.payload);
    } catch (error) {
      res.status(500).json({
        error: 'download_failed',
        details: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  });

  app.post('/api/jobs/download', (req, res) => {
    const parsed = downloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten()
      });
      return;
    }

    const job = enqueueDownloadJob(parsed.data);
    res.status(202).json({
      jobId: job.id,
      status: job.status
    });
  });

  app.post('/api/jobs/scrape', (req, res) => {
    const parsed = scrapeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten()
      });
      return;
    }

    const job = enqueueScrapeJob(parsed.data);
    res.status(202).json({
      jobId: job.id,
      status: job.status
    });
  });

  app.get('/api/jobs/scrape', (_req, res) => {
    res.json({
      items: listScrapeJobs(50).map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        progress: job.progress
      })),
      queue: getScrapeQueueStats()
    });
  });

  app.get('/api/jobs/scrape/:jobId', (req, res) => {
    const job = getScrapeJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    res.json({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progress: job.progress,
      result: job.result,
      error: job.error
    });
  });

  app.get('/api/jobs/download', (_req, res) => {
    res.json({
      items: listDownloadJobs(50).map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        progress: job.progress
      })),
      queue: getQueueStats()
    });
  });

  app.get('/api/jobs/download/:jobId', (req, res) => {
    const job = getDownloadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'job_not_found' });
      return;
    }
    res.json({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      progress: job.progress,
      result: job.result,
      error: job.error
    });
  });

  app.get('/api/history', (req, res) => {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_query',
        details: parsed.error.flatten()
      });
      return;
    }

    const page = listHistoryPage(parsed.data.limit, parsed.data.cursor);
    res.json(page);
  });

  app.get('/api/metrics', (req, res) => {
    const windowSec = Math.max(1, Math.min(3600, Number(req.query.windowSec) || 60));
    const detailed = req.query.detailed === 'true';

    const metrics = getMetricsSnapshot({ windowSec, detailed });

    // Processar rate-limit stats se detailed=true
    const rateLimiterStats = getRateLimiter().getStats();
    const rateLimits = processRateLimitStats(rateLimiterStats, detailed);

    res.json({
      ...metrics,
      queue: {
        download: getQueueStats(),
        scrape: getScrapeQueueStats()
      },
      workers: {
        scraper: scraperPool.getStats(),
        download: downloadPool.getStats()
      },
      throughput: metrics.throughput,
      ...(rateLimits && { rateLimits })
    });
  });

  app.get('/api/history/export', (_req, res) => {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="history.csv"');
    res.send(exportHistoryCsv());
  });

  app.delete('/api/history', (_req, res) => {
    const deleted = clearHistory();
    res.json({ deleted });
  });

  // Endpoint de reset completo da plataforma
  app.post('/api/reset', (_req, res) => {
    const historyDeleted = clearHistory();
    resetAllRateLimits();
    res.json({
      success: true,
      message: 'Plataforma resetada com sucesso',
      cleared: {
        history: historyDeleted,
        rateLimits: true,
        jobs: true
      }
    });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 8787);
  createServer().listen(port);
}
