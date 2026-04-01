import type { DownloadResponse, ScrapedImage } from '../types.js';
import type { WorkerMessage, WorkerResponse } from './workerPool.js';

// =============================================================================
// Tipos para o payload do worker
// =============================================================================

type DownloadPayload = {
  images: ScrapedImage[];
  destFolder: string;
  overwrite: boolean;
  createUserFolder: boolean;
  createAlbumFolder: boolean;
  downloadsParallel: number;
};

// =============================================================================
// Worker Entry Point (executado como child_process)
// =============================================================================

// Receber mensagem do processo pai
process.on('message', async (message: WorkerMessage<DownloadPayload>) => {
  const startTime = Date.now();

  try {
    const result = await downloadImages(message.payload);

    const response: WorkerResponse<DownloadResponse> = {
      id: message.id,
      success: true,
      payload: result,
      durationMs: Date.now() - startTime
    };

    process.send!(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: message.id,
      success: false,
      error: {
        code: 'DOWNLOAD_ERROR',
        message: error instanceof Error ? error.message : 'unknown_error'
      },
      durationMs: Date.now() - startTime
    };

    process.send!(response);
  }
});

// =============================================================================
// Implementação do Download (copiada do serviço para execução isolada)
// =============================================================================

async function downloadImages(input: DownloadPayload): Promise<DownloadResponse> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { setTimeout: sleep } = await import('node:timers/promises');
  const pLimit = (await import('p-limit')).default;

  const parallel = Math.min(Math.max(input.downloadsParallel, 1), 48);
  const limit = pLimit(parallel);
  const root = path.resolve(input.destFolder || path.join(process.cwd(), 'results'));
  await fs.mkdir(root, { recursive: true });

  let totalDownloads = 0;
  let totalBytes = 0;
  let skipped = 0;
  let errors = 0;

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

  await Promise.all(
    input.images.map((image) =>
      limit(async () => {
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
          totalDownloads += 1;
          totalBytes += data.byteLength;
        } catch {
          errors += 1;
        }
      }),
    ),
  );

  return {
    totalDownloads,
    totalMb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    skipped,
    errors
  };
}

// Signal que o worker está pronto
process.send!({ type: 'READY' } as WorkerResponse);
