import type {
  DownloadProgress,
  DownloadResponse,
  ScrapeProgress,
  ScrapeResponse,
  ScrapedImage
} from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
const POLL_INTERVAL_MS = 450;

async function throwApiError(response: Response, fallback: string): Promise<never> {
  try {
    const data = (await response.json()) as { details?: unknown; error?: string };
    if (typeof data.details === 'string' && data.details.length > 0) {
      throw new Error(`${fallback}: ${data.details}`);
    }
    if (data.details) {
      throw new Error(`${fallback}: ${JSON.stringify(data.details)}`);
    }
    if (typeof data.error === 'string' && data.error.length > 0) {
      throw new Error(`${fallback}: ${data.error}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
  }
  throw new Error(fallback);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ScrapeJobDetails = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: ScrapeProgress;
  result: ScrapeResponse | null;
  error: string | null;
};

type DownloadJobDetails = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: DownloadProgress;
  result: DownloadResponse | null;
  error: string | null;
};

async function startScrapeJob(payload: {
  urls: string[];
  minSizeKb: number;
  scrapeThreads: number;
  urlWorkers: number;
}): Promise<string> {
  const response = await fetch(`${API_URL}/api/jobs/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    await throwApiError(response, 'Falha ao iniciar busca');
  }
  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}

async function getScrapeJob(jobId: string): Promise<ScrapeJobDetails> {
  const response = await fetch(`${API_URL}/api/jobs/scrape/${jobId}`);
  if (!response.ok) {
    await throwApiError(response, 'Falha ao consultar progresso da busca');
  }
  return (await response.json()) as ScrapeJobDetails;
}

async function startDownloadJob(payload: {
  images: ScrapedImage[];
  destFolder: string;
  overwrite: boolean;
  createUserFolder: boolean;
  createAlbumFolder: boolean;
  downloadsParallel: number;
}): Promise<string> {
  const response = await fetch(`${API_URL}/api/jobs/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    await throwApiError(response, 'Falha ao iniciar download');
  }
  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}

async function getDownloadJob(jobId: string): Promise<DownloadJobDetails> {
  const response = await fetch(`${API_URL}/api/jobs/download/${jobId}`);
  if (!response.ok) {
    await throwApiError(response, 'Falha ao consultar progresso do download');
  }
  return (await response.json()) as DownloadJobDetails;
}

export async function scrape(payload: {
  urls: string[];
  minSizeKb: number;
  scrapeThreads: number;
  urlWorkers: number;
}, options?: {
  onProgress?: (progress: ScrapeProgress) => void;
}): Promise<ScrapeResponse> {
  const jobId = await startScrapeJob(payload);

  while (true) {
    const job = await getScrapeJob(jobId);
    options?.onProgress?.(job.progress);
    if (job.status === 'completed') {
      return (
        job.result ?? {
          images: [],
          totalImages: 0,
          discardedImages: 0,
          warnings: []
        }
      );
    }
    if (job.status === 'failed') {
      throw new Error(job.error ?? 'Falha na busca');
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function download(payload: {
  images: ScrapedImage[];
  destFolder: string;
  overwrite: boolean;
  createUserFolder: boolean;
  createAlbumFolder: boolean;
  downloadsParallel: number;
}, options?: {
  onProgress?: (progress: DownloadProgress) => void;
}): Promise<DownloadResponse> {
  const jobId = await startDownloadJob(payload);

  while (true) {
    const job = await getDownloadJob(jobId);
    options?.onProgress?.(job.progress);
    if (job.status === 'completed') {
      return (
        job.result ?? {
          totalDownloads: 0,
          totalMb: 0,
          skipped: 0,
          errors: 0
        }
      );
    }
    if (job.status === 'failed') {
      throw new Error(job.error ?? 'Falha no download');
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
