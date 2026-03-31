import { randomUUID } from 'node:crypto';

import { scrapeGalleries } from '../services/scraper.js';
import type { ScrapeProgress } from '../services/scraper.js';
import type { ScrapeResponse } from '../types.js';

export type ScrapeJobPayload = {
  urls: string[];
  minSizeKb: number;
  scrapeThreads: number;
  urlWorkers: number;
};

type ScrapeJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ScrapeJob = {
  id: string;
  status: ScrapeJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  payload: ScrapeJobPayload;
  progress: ScrapeProgress;
  result: ScrapeResponse | null;
  error: string | null;
};

const jobs = new Map<string, ScrapeJob>();

function nowIso(): string {
  return new Date().toISOString();
}

function bootProgress(payload: ScrapeJobPayload): ScrapeProgress {
  return {
    stage: 'queued',
    urlsTotal: payload.urls.length,
    urlsProcessed: 0,
    pagesTotal: 0,
    pagesProcessed: 0,
    candidates: 0,
    probed: 0,
    valid: 0,
    discarded: 0,
    warnings: 0,
    message: 'queued'
  };
}

export function enqueueScrapeJob(payload: ScrapeJobPayload): ScrapeJob {
  const id = randomUUID();
  const job: ScrapeJob = {
    id,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    payload,
    progress: bootProgress(payload),
    result: null,
    error: null
  };
  jobs.set(id, job);

  void (async () => {
    job.status = 'running';
    job.startedAt = nowIso();
    job.progress = {
      ...job.progress,
      stage: 'resolving_urls',
      message: 'job_started'
    };
    try {
      job.result = await scrapeGalleries(payload, {
        onProgress: (progress) => {
          job.progress = progress;
        }
      });
      job.status = 'completed';
      job.progress = {
        ...job.progress,
        stage: 'completed',
        message: 'job_completed'
      };
    } catch (error) {
      job.error = error instanceof Error ? error.message : 'unknown_error';
      job.status = 'failed';
      job.progress = {
        ...job.progress,
        stage: 'failed',
        message: 'job_failed'
      };
    } finally {
      job.finishedAt = nowIso();
    }
  })();

  return job;
}

export function getScrapeJob(id: string): ScrapeJob | null {
  return jobs.get(id) ?? null;
}

export function listScrapeJobs(limit = 50): ScrapeJob[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function getScrapeQueueStats(): { running: number; totalJobs: number } {
  let running = 0;
  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'queued') {
      running += 1;
    }
  }
  return {
    running,
    totalJobs: jobs.size
  };
}

