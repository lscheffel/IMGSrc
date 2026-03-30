import { randomUUID } from 'node:crypto';

import { downloadImages } from '../services/downloader.js';
import type { DownloadInput } from '../services/downloader.js';
import type { DownloadResponse } from '../types.js';

type DownloadJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type DownloadJob = {
  id: string;
  status: DownloadJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  payload: DownloadInput;
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
  try {
    job.result = await downloadImages(job.payload);
    job.status = 'completed';
  } catch (error) {
    job.error = error instanceof Error ? error.message : 'unknown_error';
    job.status = 'failed';
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

