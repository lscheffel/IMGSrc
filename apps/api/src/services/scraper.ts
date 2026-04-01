import { setTimeout as sleep } from 'node:timers/promises';

import { load } from 'cheerio';
import pLimit from 'p-limit';

import type { ScrapeResponse, ScrapedImage } from '../types.js';

type ScrapeInput = {
  urls: string[];
  minSizeKb: number;
  scrapeThreads: number;
  urlWorkers: number;
};

export type ScrapeProgress = {
  stage: 'queued' | 'resolving_urls' | 'scanning_pages' | 'probing_images' | 'completed' | 'failed';
  urlsTotal: number;
  urlsProcessed: number;
  pagesTotal: number;
  pagesProcessed: number;
  candidates: number;
  probed: number;
  valid: number;
  discarded: number;
  warnings: number;
  message?: string;
};

type ScrapeOptions = {
  onProgress?: (progress: ScrapeProgress) => void;
};

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

function addWarning(warnings: string[], message: string): void {
  if (warnings.length < MAX_WARNINGS) {
    warnings.push(message);
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

export async function scrapeGalleries(
  input: ScrapeInput,
  options?: ScrapeOptions,
): Promise<ScrapeResponse> {
  const minBytes = Math.max(1, input.minSizeKb) * 1024;
  const scrapeLimit = pLimit(Math.min(Math.max(input.scrapeThreads, 1), 10));
  const probeLimit = pLimit(Math.min(Math.max(input.urlWorkers, 1), 16));

  let totalImages = 0;
  let discardedImages = 0;
  const foundImages: ScrapedImage[] = [];
  const dedupe = new Set<string>();
  const warnings: string[] = [];
  const progress: ScrapeProgress = {
    stage: 'resolving_urls',
    urlsTotal: input.urls.length,
    urlsProcessed: 0,
    pagesTotal: 0,
    pagesProcessed: 0,
    candidates: 0,
    probed: 0,
    valid: 0,
    discarded: 0,
    warnings: 0
  };
  let lastEmit = 0;
  const emitProgress = (force = false, message?: string): void => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) {
      return;
    }
    lastEmit = now;
    progress.valid = foundImages.length;
    progress.discarded = discardedImages;
    progress.warnings = warnings.length;
    if (message) {
      progress.message = message;
    }
    options?.onProgress?.({ ...progress });
  };
  emitProgress(true, 'scrape_started');

  for (const rawUrl of input.urls) {
    const sourceUrl = rawUrl.trim();
    if (!sourceUrl) {
      continue;
    }

    if (!isImgsrcUrl(sourceUrl)) {
      addWarning(warnings, `url_invalida_ou_fora_do_dominio: ${sourceUrl}`);
      progress.urlsProcessed += 1;
      emitProgress(false, 'url_invalid');
      continue;
    }

    let tapeUrl = sourceUrl;
    if (!isTapeUrl(sourceUrl)) {
      const galleryHtml = await safeFetchText(sourceUrl, warnings, 'galeria');
      if (!galleryHtml) {
        progress.urlsProcessed += 1;
        emitProgress(false, 'gallery_unreachable');
        continue;
      }
      const galleryDoc = load(galleryHtml);
      const tapeHref = galleryDoc('a[href*="tape-"]').first().attr('href');
      if (!tapeHref) {
        addWarning(warnings, `tape_nao_encontrado: ${sourceUrl}`);
        progress.urlsProcessed += 1;
        emitProgress(false, 'tape_not_found');
        continue;
      }
      try {
        tapeUrl = new URL(tapeHref, GALLERY_PREFIX).toString();
      } catch {
        addWarning(warnings, `tape_url_invalida: ${sourceUrl}`);
        progress.urlsProcessed += 1;
        emitProgress(false, 'tape_invalid');
        continue;
      }
    }

    const tapeHtml = await safeFetchText(tapeUrl, warnings, 'tape');
    if (!tapeHtml) {
      progress.urlsProcessed += 1;
      emitProgress(false, 'tape_unreachable');
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
    progress.pagesTotal += pageUrls.size;
    progress.stage = 'scanning_pages';
    emitProgress(false, 'pages_discovered');

    await Promise.all(
      Array.from(pageUrls).map((pageUrl) =>
        scrapeLimit(async () => {
          try {
            const pageHtml = await safeFetchText(pageUrl, warnings, 'pagina');
            if (!pageHtml) {
              progress.pagesProcessed += 1;
              emitProgress(false, 'page_unreachable');
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

              if (!/\.(webp|gif|jpg|png)(\?|$)/i.test(normalized)) {
                return;
              }
              totalImages += 1;
              if (/\.(jpg|png)(\?|$)/i.test(normalized)) {
                discardedImages += 1;
                progress.probed += 1;
                emitProgress(false);
                return;
              }
              candidates.push(normalized);
              progress.candidates += 1;
            });
            progress.stage = 'probing_images';
            emitProgress(false, 'probing_images');

            await Promise.all(
              candidates.map((candidate) =>
                probeLimit(async () => {
                  const size = await probeImage(candidate, minBytes);
                  progress.probed += 1;
                  if (!size) {
                    discardedImages += 1;
                    emitProgress(false);
                    return;
                  }
                  const key = `${candidate}::${size}`;
                  if (dedupe.has(key)) {
                    emitProgress(false);
                    return;
                  }
                  dedupe.add(key);
                  foundImages.push({
                    url: candidate,
                    size,
                    user,
                    title: pageTitle
                  });
                  emitProgress(false);
                }),
              ),
            );
            progress.pagesProcessed += 1;
            emitProgress(false, 'page_processed');
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'erro_desconhecido';
            addWarning(warnings, `falha_pagina: ${pageUrl} (${msg})`);
            progress.pagesProcessed += 1;
            emitProgress(false, 'page_failed');
          }
        }),
      ),
    );
    progress.urlsProcessed += 1;
    emitProgress(false, 'url_processed');
  }

  progress.stage = 'completed';
  emitProgress(true, 'scrape_completed');

  return {
    images: foundImages,
    totalImages,
    discardedImages,
    warnings
  };
}
