import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import pLimit from 'p-limit';

import { findDownloadByHash, upsertDownload } from '../db.js';
import type { DownloadResponse, ScrapedImage } from '../types.js';
import { md5 } from '../utils/hash.js';

export type DownloadInput = {
  images: ScrapedImage[];
  destFolder: string;
  overwrite: boolean;
  createUserFolder: boolean;
  createAlbumFolder: boolean;
  downloadsParallel: number;
};

export type DownloadProgress = {
  stage: 'queued' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  downloaded: number;
  skipped: number;
  errors: number;
  bytes: number;
  message?: string;
};

type DownloadOptions = {
  onProgress?: (progress: DownloadProgress) => void;
};

function sanitizeSegment(value: string): string {
  return value.replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '_') || 'unknown';
}

function buildFilename(url: string): string {
  const pathname = new URL(url).pathname;
  const base = sanitizeSegment(path.basename(pathname));
  if (/\.(webp|gif)$/i.test(base)) {
    return base;
  }
  return `${base}.webp`;
}

function nowSqlDate(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function fetchImage(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url);
    if (response.status === 404 && attempt < 2) {
      await sleep(300);
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) {
      throw new Error(`Conteudo invalido: ${type}`);
    }
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
  }
  throw new Error('Falha apos retries');
}

export async function downloadImages(
  input: DownloadInput,
  options?: DownloadOptions,
): Promise<DownloadResponse> {
  const parallel = Math.min(Math.max(input.downloadsParallel, 1), 48);
  const limit = pLimit(parallel);
  const root = path.resolve(input.destFolder || path.join(process.cwd(), 'results'));
  await fs.mkdir(root, { recursive: true });

  let totalDownloads = 0;
  let totalBytes = 0;
  let skipped = 0;
  let errors = 0;
  let processed = 0;

  const progress: DownloadProgress = {
    stage: 'running',
    total: input.images.length,
    processed: 0,
    downloaded: 0,
    skipped: 0,
    errors: 0,
    bytes: 0
  };

  let lastEmit = 0;
  const emitProgress = (force = false, message?: string): void => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) {
      return;
    }
    lastEmit = now;
    if (message) {
      progress.message = message;
    }
    progress.processed = processed;
    progress.downloaded = totalDownloads;
    progress.skipped = skipped;
    progress.errors = errors;
    progress.bytes = totalBytes;
    options?.onProgress?.({ ...progress });
  };
  emitProgress(true, 'download_started');

  await Promise.all(
    input.images.map((image) =>
      limit(async () => {
        const urlHash = md5(image.url);
        if (!input.overwrite && findDownloadByHash(urlHash)) {
          skipped += 1;
          processed += 1;
          emitProgress(false, 'item_skipped');
          return;
        }

        let folder = root;
        if (input.createUserFolder) {
          folder = path.join(folder, sanitizeSegment(image.user));
        }
        if (input.createAlbumFolder) {
          folder = path.join(folder, sanitizeSegment(image.title));
        }
        await fs.mkdir(folder, { recursive: true });

        let filename = buildFilename(image.url);
        let fullPath = path.join(folder, filename);
        if (!input.overwrite) {
          try {
            await fs.access(fullPath);
            const ext = path.extname(filename);
            const base = path.basename(filename, ext);
            filename = `${base}_${Date.now()}${ext}`;
            fullPath = path.join(folder, filename);
          } catch {
            // arquivo ainda nao existe
          }
        }

        try {
          const data = await fetchImage(image.url);
          await fs.writeFile(fullPath, data);
          upsertDownload({
            filename,
            user: image.user,
            url: image.url,
            urlHash,
            downloadDate: nowSqlDate(),
            path: fullPath,
            status: 'active'
          });
          totalDownloads += 1;
          totalBytes += data.byteLength;
          processed += 1;
          emitProgress(false, 'item_downloaded');
        } catch {
          errors += 1;
          processed += 1;
          emitProgress(false, 'item_failed');
        }
      }),
    ),
  );

  progress.stage = 'completed';
  emitProgress(true, 'download_completed');

  return {
    totalDownloads,
    totalMb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    skipped,
    errors
  };
}
