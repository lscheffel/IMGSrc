import { performance } from 'node:perf_hooks';

import cors from 'cors';
import express from 'express';
import { z } from 'zod';

import { clearHistory, exportHistoryCsv, listHistory } from './db.js';
import { downloadImages } from './services/downloader.js';
import { scrapeGalleries } from './services/scraper.js';
import { getMetricsSnapshot, observeHttpMetric } from './telemetry/metrics.js';
import {
  enqueueDownloadJob,
  getDownloadJob,
  getQueueStats,
  listDownloadJobs
} from './workers/downloadQueue.js';

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

export function createServer() {
  const app = express();
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
      const result = await scrapeGalleries(parsed.data);
      res.json(result);
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
      const result = await downloadImages(parsed.data);
      res.json(result);
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

  app.get('/api/jobs/download', (_req, res) => {
    res.json({
      items: listDownloadJobs(50).map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt
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
      result: job.result,
      error: job.error
    });
  });

  app.get('/api/history', (_req, res) => {
    res.json({
      items: listHistory(1000)
    });
  });

  app.get('/api/metrics', (_req, res) => {
    res.json({
      ...getMetricsSnapshot(),
      queue: getQueueStats()
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

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 8787);
  createServer().listen(port);
}
