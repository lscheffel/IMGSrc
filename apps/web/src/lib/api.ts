import type { DownloadResponse, ScrapeResponse, ScrapedImage } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

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

export async function scrape(payload: {
  urls: string[];
  minSizeKb: number;
  scrapeThreads: number;
  urlWorkers: number;
}): Promise<ScrapeResponse> {
  const response = await fetch(`${API_URL}/api/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    await throwApiError(response, 'Falha na busca');
  }
  return (await response.json()) as ScrapeResponse;
}

export async function download(payload: {
  images: ScrapedImage[];
  destFolder: string;
  overwrite: boolean;
  createUserFolder: boolean;
  createAlbumFolder: boolean;
  downloadsParallel: number;
}): Promise<DownloadResponse> {
  const response = await fetch(`${API_URL}/api/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    await throwApiError(response, 'Falha no download');
  }
  return (await response.json()) as DownloadResponse;
}
