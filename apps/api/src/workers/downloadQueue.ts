import { randomUUID } from 'node:crypto';

import { downloadImages } from '../services/downloader.js';
import type { DownloadInput, DownloadProgress } from '../services/downloader.js';
import type { DownloadResponse } from '../types.js';

type DownloadJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type DownloadJob = {
  id: string;
  status: DownloadJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  payload: DownloadInput;
  progress: DownloadProgress;
  result: DownloadResponse | null;
  error: string | null;
};

const jobs = new Map<string, DownloadJob>();
const pending: string[] = [];
let isRunning = false;

function nowIso(): string {
  return new Date().toISOString();
}

async function runNext(): Promise<void> {
  if (isRunning) {
    return;
  }
  const nextId = pending.shift();
  if (!nextId) {
    return;
  }

  const job = jobs.get(nextId);
  if (!job) {
    return;
  }

  isRunning = true;
  job.status = 'running';
  job.startedAt = nowIso();
  job.progress = {
    ...job.progress,
    stage: 'running',
    message: 'job_started'
  };
  try {
    job.result = await downloadImages(job.payload, {
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
      message: 'job_failed',
      errors: job.progress.errors + 1
    };
  } finally {
    job.finishedAt = nowIso();
    isRunning = false;
    await runNext();
  }
}

export function enqueueDownloadJob(payload: DownloadInput): DownloadJob {
  const id = randomUUID();
  const job: DownloadJob = {
    id,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    payload,
    progress: {
      stage: 'queued',
      total: payload.images.length,
      processed: 0,
      downloaded: 0,
      skipped: 0,
      errors: 0,
      bytes: 0,
      message: 'queued'
    },
    result: null,
    error: null
  };
  jobs.set(id, job);
  pending.push(id);
  void runNext();
  return job;
}

export function getDownloadJob(id: string): DownloadJob | null {
  return jobs.get(id) ?? null;
}

export function listDownloadJobs(limit = 50): DownloadJob[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function getQueueStats(): { queued: number; running: boolean; totalJobs: number } {
  return {
    queued: pending.length,
    running: isRunning,
    totalJobs: jobs.size
  };
}
