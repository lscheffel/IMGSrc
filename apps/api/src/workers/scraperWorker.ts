import { parentPort } from 'node:worker_threads';
import type { ScrapedImage, ScrapeResponse } from '../types.js';
import type { WorkerMessage, WorkerResponse } from './workerPool.js';

// =============================================================================
// Tipos para o payload do worker
// =============================================================================

type ScrapePayload = {
  urls: string[];
  minSizeKb: number;
  scrapeThreads: number;
  urlWorkers: number;
};

// =============================================================================
// Worker Entry Point (executado como worker_threads)
// =============================================================================

// Verificar se está sendo executado como worker
if (!parentPort) {
  console.error('Este arquivo deve ser executado como worker_threads');
  process.exit(1);
}

// =============================================================================
// Handler de mensagens do worker - recebe via parentPort (IPC)
// =============================================================================

parentPort.on('message', async (message: WorkerMessage<ScrapePayload>) => {
  const startTime = Date.now();

  try {
    const result = await scrapeGalleries(message.payload);

    const response: WorkerResponse<ScrapeResponse> = {
      id: message.id,
      success: true,
      payload: result,
      durationMs: Date.now() - startTime
    };

    parentPort!.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: message.id,
      success: false,
      error: {
        code: 'SCRAPE_ERROR',
        message: error instanceof Error ? error.message : 'unknown_error'
      },
      durationMs: Date.now() - startTime
    };

    parentPort!.postMessage(response);
  }
});

// =============================================================================
// Implementação do Scrape (copiada do serviço para execução isolada)
// =============================================================================

const GALLERY_PREFIX = 'https://imgsrc.ru';
const MAX_WARNINGS = 40;

function sanitizeTitle(raw: string): string {
  const base = raw.split(' @')[0]?.trim() ?? '';
  return base
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+$/g, '') || `album_${Date.now()}`;
}

function normalizeImgUrl(raw: string): string {
  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return new URL(raw, GALLERY_PREFIX).toString();
}

function pullSrc(srcOrSrcset: string): string {
  const first = srcOrSrcset.split(',')[0]?.trim() ?? '';
  return first.split(' ')[0] ?? '';
}

function addWarning(warnings: string[], msg: string): void {
  if (warnings.length < MAX_WARNINGS) {
    warnings.push(msg);
  }
}

function isImgsrcUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('imgsrc.ru');
  } catch {
    return false;
  }
}

function isTapeUrl(url: string): boolean {
  return /\/tape-\d+-\d+-\d+\.html(?:\?.*)?$/i.test(url);
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        referer: GALLERY_PREFIX,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeFetchText(
  url: string,
  warnings: string[],
  context: string,
  retries = 2,
): Promise<string | null> {
  const { setTimeout: sleep } = await import('node:timers/promises');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, 10000);
      if (!response.ok) {
        if (attempt < retries && response.status >= 500) {
          await sleep(250);
          continue;
        }
        addWarning(warnings, `${context}: HTTP ${response.status} em ${url}`);
        return null;
      }
      return await response.text();
    } catch (error) {
      if (attempt < retries) {
        await sleep(250);
        continue;
      }
      const msg = error instanceof Error ? error.message : 'erro_desconhecido';
      addWarning(warnings, `${context}: ${msg} em ${url}`);
      return null;
    }
  }
  return null;
}

async function probeImage(url: string, minBytes: number): Promise<number | null> {
  const { setTimeout: sleep } = await import('node:timers/promises');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, 8000);
      if (response.status === 404 && attempt < 2) {
        await sleep(300);
        continue;
      }
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) {
        return null;
      }
      const sizeFromHeader = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(sizeFromHeader) && sizeFromHeader > 0) {
        if (response.body) {
          await response.body.cancel();
        }
        return sizeFromHeader >= minBytes ? sizeFromHeader : null;
      }
      const buff = Buffer.from(await response.arrayBuffer());
      return buff.byteLength >= minBytes ? buff.byteLength : null;
    } catch {
      if (attempt < 2) {
        await sleep(300);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function scrapeGalleries(
  input: ScrapePayload,
): Promise<ScrapeResponse> {
  const { load } = await import('cheerio');
  const pLimit = (await import('p-limit')).default;

  const minBytes = Math.max(1, input.minSizeKb) * 1024;
  const scrapeLimit = pLimit(Math.min(Math.max(input.scrapeThreads, 1), 10));
  const probeLimit = pLimit(Math.min(Math.max(input.urlWorkers, 1), 16));

  let discardedImages = 0;
  const foundImages: ScrapedImage[] = [];
  const warnings: string[] = [];

  for (const rawUrl of input.urls) {
    const sourceUrl = rawUrl.trim();
    if (!sourceUrl) {
      continue;
    }

    if (!isImgsrcUrl(sourceUrl)) {
      addWarning(warnings, `url_invalida_ou_fora_do_dominio: ${sourceUrl}`);
      continue;
    }

    let tapeUrl = sourceUrl;
    if (!isTapeUrl(sourceUrl)) {
      const galleryHtml = await safeFetchText(sourceUrl, warnings, 'galeria');
      if (!galleryHtml) {
        continue;
      }
      const galleryDoc = load(galleryHtml);
      const tapeHref = galleryDoc('a[href*="tape-"]').first().attr('href');
      if (!tapeHref) {
        addWarning(warnings, `tape_nao_encontrado: ${sourceUrl}`);
        continue;
      }
      try {
        tapeUrl = new URL(tapeHref, GALLERY_PREFIX).toString();
      } catch {
        addWarning(warnings, `tape_url_invalida: ${sourceUrl}`);
        continue;
      }
    }

    const tapeHtml = await safeFetchText(tapeUrl, warnings, 'tape');
    if (!tapeHtml) {
      continue;
    }
    const tapeDoc = load(tapeHtml);
    const pageTitle = sanitizeTitle(tapeDoc('title').first().text());
    const user = /https:\/\/imgsrc\.ru\/([^/]+)\//.exec(tapeUrl)?.[1] ?? 'unknown_user';

    const pageUrls = new Set<string>([tapeUrl]);
    tapeDoc('a[href*="tape-"]').each((_, el) => {
      const href = tapeDoc(el).attr('href');
      if (!href) {
        return;
      }
      try {
        pageUrls.add(new URL(href, GALLERY_PREFIX).toString());
      } catch {
        addWarning(warnings, `pagina_tape_invalida: ${href}`);
      }
    });

    await Promise.all(
      Array.from(pageUrls).map((pageUrl) =>
        scrapeLimit(async () => {
          try {
            const pageHtml = await safeFetchText(pageUrl, warnings, 'pagina');
            if (!pageHtml) {
              return;
            }
            const pageDoc = load(pageHtml);
            const candidates: string[] = [];

            pageDoc('source[srcset], img[srcset], img[src]').each((_, element) => {
              const srcset = pageDoc(element).attr('srcset');
              const src = pageDoc(element).attr('src');
              const raw = srcset ? pullSrc(srcset) : src ?? '';
              if (!raw || raw.includes('/images/1.gif')) {
                return;
              }

              let normalized = '';
              try {
                normalized = normalizeImgUrl(raw);
              } catch {
                addWarning(warnings, `imagem_url_invalida: ${raw}`);
                discardedImages += 1;
                return;
              }

              if (normalized.startsWith('https://cs') || normalized.includes('/thumbs/')) {
                return;
              }
              candidates.push(normalized);
            });

            await Promise.all(
              candidates.map((candidate) =>
                probeLimit(async () => {
                  const size = await probeImage(candidate, minBytes);
                  if (size !== null) {
                    foundImages.push({
                      url: candidate,
                      size,
                      user,
                      title: pageTitle
                    });
                  } else {
                    discardedImages += 1;
                  }
                }),
              ),
            );
          } catch {
            addWarning(warnings, `pagina_falha: ${pageUrl}`);
          }
        }),
      ),
    );
  }

  return {
    images: foundImages,
    totalImages: foundImages.length,
    discardedImages,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}
