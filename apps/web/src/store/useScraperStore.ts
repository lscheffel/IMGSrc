import { create } from 'zustand';

import { download, scrape } from '../lib/api';
import type {
  DownloadProgress,
  DownloadResponse,
  ScrapeProgress,
  ScrapeResponse,
  ScrapedImage
} from '../types';

type TimelinePoint = {
  ts: number;
  percent: number;
};

type SearchLiveMetrics = {
  startedAt: number | null;
  updatedAt: number | null;
  elapsedSec: number;
  pagesPerSec: number;
  validPerSec: number;
  etaSec: number | null;
};

type DownloadLiveMetrics = {
  startedAt: number | null;
  updatedAt: number | null;
  elapsedSec: number;
  filesPerSec: number;
  mbPerSec: number;
  etaSec: number | null;
};

type LiveEvent = {
  at: number;
  channel: 'search' | 'download' | 'one-click' | 'system';
  text: string;
};

export type PresetName = 'safe' | 'balanced' | 'turbo';

type OneClickProgress = {
  stage: 'idle' | 'searching' | 'downloading' | 'completed' | 'failed';
  percent: number;
  message: string;
};

type ScraperState = {
  urlsInput: string;
  minSizeKb: number;
  scrapeThreads: number;
  urlWorkers: number;
  downloadsParallel: number;
  destFolder: string;
  overwrite: boolean;
  createUserFolder: boolean;
  createAlbumFolder: boolean;
  loading: boolean;
  images: ScrapedImage[];
  totalImages: number;
  discardedImages: number;
  warnings: string[];
  searchProgress: ScrapeProgress | null;
  downloadProgress: DownloadProgress | null;
  searchTimeline: TimelinePoint[];
  downloadTimeline: TimelinePoint[];
  oneClickTimeline: TimelinePoint[];
  selectedPreset: PresetName;
  searchLive: SearchLiveMetrics;
  downloadLive: DownloadLiveMetrics;
  liveEvents: LiveEvent[];
  oneClickProgress: OneClickProgress;
  downloadStats: DownloadResponse | null;
  error: string | null;
  setField: <K extends keyof ScraperState>(field: K, value: ScraperState[K]) => void;
  applyPreset: (preset: PresetName) => void;
  runSearch: () => Promise<void>;
  runDownload: () => Promise<void>;
  runOneClick: () => Promise<void>;
  resetPlatform: () => Promise<void>;
};

export function parseUrls(input: string): string[] {
  return input
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const MAX_TIMELINE_POINTS = 120;
const MAX_LIVE_EVENTS = 16;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function appendTimeline(points: TimelinePoint[], point: TimelinePoint): TimelinePoint[] {
  const next = [...points, point];
  if (next.length > MAX_TIMELINE_POINTS) {
    return next.slice(next.length - MAX_TIMELINE_POINTS);
  }
  return next;
}

function appendEvent(
  events: LiveEvent[],
  channel: LiveEvent['channel'],
  text: string,
): LiveEvent[] {
  const value = text.trim();
  if (!value) {
    return events;
  }
  const latest = events.at(-1);
  if (latest && latest.channel === channel && latest.text === value) {
    return events;
  }
  const next = [...events, { at: Date.now(), channel, text: value }];
  if (next.length > MAX_LIVE_EVENTS) {
    return next.slice(next.length - MAX_LIVE_EVENTS);
  }
  return next;
}

function baseSearchMetrics(): SearchLiveMetrics {
  return {
    startedAt: null,
    updatedAt: null,
    elapsedSec: 0,
    pagesPerSec: 0,
    validPerSec: 0,
    etaSec: null
  };
}

function baseDownloadMetrics(): DownloadLiveMetrics {
  return {
    startedAt: null,
    updatedAt: null,
    elapsedSec: 0,
    filesPerSec: 0,
    mbPerSec: 0,
    etaSec: null
  };
}

function computeSearchRatio(progress: ScrapeProgress): number {
  if (progress.pagesTotal > 0) {
    return progress.pagesProcessed / progress.pagesTotal;
  }
  if (progress.urlsTotal > 0) {
    return progress.urlsProcessed / progress.urlsTotal;
  }
  return 0;
}

export const useScraperStore = create<ScraperState>((set, get) => ({
  urlsInput: '',
  minSizeKb: 10,
  scrapeThreads: 2,
  urlWorkers: 6,
  downloadsParallel: 16,
  destFolder: './results',
  overwrite: false,
  createUserFolder: true,
  createAlbumFolder: true,
  loading: false,
  images: [],
  totalImages: 0,
  discardedImages: 0,
  warnings: [],
  searchProgress: null,
  downloadProgress: null,
  searchTimeline: [],
  downloadTimeline: [],
  oneClickTimeline: [],
  selectedPreset: 'balanced',
  searchLive: baseSearchMetrics(),
  downloadLive: baseDownloadMetrics(),
  liveEvents: [],
  oneClickProgress: {
    stage: 'idle',
    percent: 0,
    message: ''
  },
  downloadStats: null,
  error: null,
  setField: (field, value) => set({ [field]: value } as Partial<ScraperState>),
  applyPreset: (preset) => {
    if (preset === 'safe') {
      set({
        selectedPreset: preset,
        minSizeKb: 20,
        scrapeThreads: 1,
        urlWorkers: 4,
        downloadsParallel: 6,
        liveEvents: appendEvent(get().liveEvents, 'system', 'Preset safe aplicado')
      });
      return;
    }
    if (preset === 'turbo') {
      set({
        selectedPreset: preset,
        minSizeKb: 8,
        scrapeThreads: 4,
        urlWorkers: 10,
        downloadsParallel: 24,
        liveEvents: appendEvent(get().liveEvents, 'system', 'Preset turbo aplicado')
      });
      return;
    }
    set({
      selectedPreset: 'balanced',
      minSizeKb: 10,
      scrapeThreads: 2,
      urlWorkers: 6,
      downloadsParallel: 16,
      liveEvents: appendEvent(get().liveEvents, 'system', 'Preset balanced aplicado')
    });
  },
  runSearch: async () => {
    const state = get();
    const urls = parseUrls(state.urlsInput);
    if (!urls.length) {
      set({ error: 'Informe ao menos uma URL válida.' });
      return;
    }
    set({
      loading: true,
      error: null,
      downloadStats: null,
      warnings: [],
      searchProgress: null,
      searchTimeline: [],
      searchLive: baseSearchMetrics(),
      liveEvents: appendEvent(get().liveEvents, 'search', 'Busca iniciada')
    });
    try {
      const result: ScrapeResponse = await scrape({
        urls,
        minSizeKb: state.minSizeKb,
        scrapeThreads: state.scrapeThreads,
        urlWorkers: state.urlWorkers
      }, {
        onProgress: (progress) => {
          const snapshot = get();
          const previous = snapshot.searchProgress;
          const now = Date.now();
          const currentSearchRatio = computeSearchRatio(progress);
          const searchPercent = clampPercent(currentSearchRatio * 100);

          const startedAt = snapshot.searchLive.startedAt ?? now;
          const elapsedSec = (now - startedAt) / 1000;
          const deltaSec = snapshot.searchLive.updatedAt
            ? Math.max((now - snapshot.searchLive.updatedAt) / 1000, 0.001)
            : 0;
          const deltaPages = previous
            ? Math.max(0, progress.pagesProcessed - previous.pagesProcessed)
            : progress.pagesProcessed;
          const deltaValid = previous ? Math.max(0, progress.valid - previous.valid) : progress.valid;
          const pagesPerSec = deltaSec > 0 ? deltaPages / deltaSec : snapshot.searchLive.pagesPerSec;
          const validPerSec = deltaSec > 0 ? deltaValid / deltaSec : snapshot.searchLive.validPerSec;
          const remainingPages = Math.max(0, progress.pagesTotal - progress.pagesProcessed);
          const etaSec = pagesPerSec > 0 ? remainingPages / pagesPerSec : null;

          const searchTimeline = appendTimeline(snapshot.searchTimeline, {
            ts: now,
            percent: searchPercent
          });

          const oneClick = snapshot.oneClickProgress;
          let oneClickPatch: Partial<ScraperState> = {};
          if (oneClick.stage === 'searching') {
            const urlRatio =
              progress.urlsTotal > 0 ? progress.urlsProcessed / progress.urlsTotal : 0;
            const pageRatio =
              progress.pagesTotal > 0 ? progress.pagesProcessed / progress.pagesTotal : urlRatio;
            const combined = Math.min(1, Math.max(urlRatio, (urlRatio * 0.4) + (pageRatio * 0.6)));
            const oneClickPercent = Math.min(50, Math.round(combined * 50));
            oneClickPatch = {
              oneClickProgress: {
                ...oneClick,
                percent: oneClickPercent,
                message: progress.message ?? 'Buscando imagens...'
              },
              oneClickTimeline: appendTimeline(snapshot.oneClickTimeline, {
                ts: now,
                percent: oneClickPercent
              })
            };
          }
          const previousPercent = snapshot.searchTimeline.at(-1)?.percent ?? -1;
          const shouldLog =
            !previous ||
            previous.stage !== progress.stage ||
            Math.abs(searchPercent - previousPercent) >= 15;
          const liveEvents = shouldLog
            ? appendEvent(
                snapshot.liveEvents,
                'search',
                `Busca ${progress.stage} ${progress.pagesProcessed}/${progress.pagesTotal}`,
              )
            : snapshot.liveEvents;
          set({
            searchProgress: progress,
            searchTimeline,
            searchLive: {
              startedAt,
              updatedAt: now,
              elapsedSec,
              pagesPerSec,
              validPerSec,
              etaSec
            },
            liveEvents,
            ...oneClickPatch
          });
        }
      });
      set({
        images: result.images,
        totalImages: result.totalImages,
        discardedImages: result.discardedImages,
        warnings: result.warnings ?? [],
        liveEvents: appendEvent(get().liveEvents, 'search', `Busca concluida: ${result.images.length} validas`)
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Erro na busca.',
        warnings: [],
        liveEvents: appendEvent(get().liveEvents, 'search', 'Busca falhou')
      });
    } finally {
      set({ loading: false });
    }
  },
  runDownload: async () => {
    const state = get();
    if (!state.images.length) {
      set({ error: 'Sem imagens para download.' });
      return;
    }
    set({
      loading: true,
      error: null,
      downloadProgress: null,
      downloadTimeline: [],
      downloadLive: baseDownloadMetrics(),
      liveEvents: appendEvent(get().liveEvents, 'download', 'Download iniciado')
    });
    try {
      const result = await download({
        images: state.images,
        destFolder: state.destFolder,
        overwrite: state.overwrite,
        createUserFolder: state.createUserFolder,
        createAlbumFolder: state.createAlbumFolder,
        downloadsParallel: state.downloadsParallel
      }, {
        onProgress: (progress) => {
          const snapshot = get();
          const previous = snapshot.downloadProgress;
          const now = Date.now();

          const ratio = progress.total > 0 ? progress.processed / progress.total : 0;
          const downloadPercent = clampPercent(ratio * 100);

          const startedAt = snapshot.downloadLive.startedAt ?? now;
          const elapsedSec = (now - startedAt) / 1000;
          const deltaSec = snapshot.downloadLive.updatedAt
            ? Math.max((now - snapshot.downloadLive.updatedAt) / 1000, 0.001)
            : 0;
          const deltaProcessed = previous
            ? Math.max(0, progress.processed - previous.processed)
            : progress.processed;
          const deltaBytes = previous ? Math.max(0, progress.bytes - previous.bytes) : progress.bytes;
          const filesPerSec = deltaSec > 0
            ? deltaProcessed / deltaSec
            : snapshot.downloadLive.filesPerSec;
          const mbPerSec = deltaSec > 0
            ? deltaBytes / (1024 * 1024) / deltaSec
            : snapshot.downloadLive.mbPerSec;
          const remaining = Math.max(0, progress.total - progress.processed);
          const etaSec = filesPerSec > 0 ? remaining / filesPerSec : null;

          const downloadTimeline = appendTimeline(snapshot.downloadTimeline, {
            ts: now,
            percent: downloadPercent
          });

          const oneClick = snapshot.oneClickProgress;
          let oneClickPatch: Partial<ScraperState> = {};
          if (oneClick.stage === 'downloading') {
            const oneClickPercent = 50 + Math.round(Math.min(1, ratio) * 50);
            oneClickPatch = {
              oneClickProgress: {
                ...oneClick,
                percent: oneClickPercent,
                message: progress.message ?? 'Baixando arquivos...'
              },
              oneClickTimeline: appendTimeline(snapshot.oneClickTimeline, {
                ts: now,
                percent: oneClickPercent
              })
            };
          }
          const previousPercent = snapshot.downloadTimeline.at(-1)?.percent ?? -1;
          const shouldLog =
            !previous ||
            previous.stage !== progress.stage ||
            Math.abs(downloadPercent - previousPercent) >= 15;
          const liveEvents = shouldLog
            ? appendEvent(
                snapshot.liveEvents,
                'download',
                `Download ${progress.stage} ${progress.processed}/${progress.total}`,
              )
            : snapshot.liveEvents;
          set({
            downloadProgress: progress,
            downloadTimeline,
            downloadLive: {
              startedAt,
              updatedAt: now,
              elapsedSec,
              filesPerSec,
              mbPerSec,
              etaSec
            },
            liveEvents,
            ...oneClickPatch
          });
        }
      });
      set({
        downloadStats: result,
        liveEvents: appendEvent(
          get().liveEvents,
          'download',
          `Download concluido: ${result.totalDownloads} arquivos`,
        )
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Erro no download.',
        liveEvents: appendEvent(get().liveEvents, 'download', 'Download falhou')
      });
    } finally {
      set({ loading: false });
    }
  },
  runOneClick: async () => {
    const oneClickStart = Date.now();
    set({
      oneClickProgress: {
        stage: 'searching',
        percent: 2,
        message: 'Iniciando busca...'
      },
      oneClickTimeline: [{ ts: oneClickStart, percent: 2 }],
      liveEvents: appendEvent(get().liveEvents, 'one-click', 'One-click iniciado'),
      error: null
    });
    await get().runSearch();
    if (get().error) {
      const failedAt = Date.now();
      set({
        oneClickProgress: {
          stage: 'failed',
          percent: 100,
          message: get().error ?? 'Falha no one-click.'
        },
        oneClickTimeline: appendTimeline(get().oneClickTimeline, { ts: failedAt, percent: 100 }),
        liveEvents: appendEvent(get().liveEvents, 'one-click', 'One-click falhou na busca')
      });
      return;
    }
    if (get().images.length <= 0) {
      const doneAt = Date.now();
      set({
        oneClickProgress: {
          stage: 'completed',
          percent: 100,
          message: 'Busca concluída sem imagens válidas.'
        },
        oneClickTimeline: appendTimeline(get().oneClickTimeline, { ts: doneAt, percent: 100 }),
        liveEvents: appendEvent(get().liveEvents, 'one-click', 'One-click sem imagens validas')
      });
      return;
    }
    const downloadStart = Date.now();
    set({
      oneClickProgress: {
        stage: 'downloading',
        percent: 52,
        message: 'Iniciando downloads...'
      },
      oneClickTimeline: appendTimeline(get().oneClickTimeline, { ts: downloadStart, percent: 52 }),
      liveEvents: appendEvent(get().liveEvents, 'one-click', 'One-click iniciou downloads')
    });
    await get().runDownload();
    if (get().error) {
      const failedAt = Date.now();
      set({
        oneClickProgress: {
          stage: 'failed',
          percent: 100,
          message: get().error ?? 'Falha no one-click.'
        },
        oneClickTimeline: appendTimeline(get().oneClickTimeline, { ts: failedAt, percent: 100 }),
        liveEvents: appendEvent(get().liveEvents, 'one-click', 'One-click falhou no download')
      });
      return;
    }
    const completedAt = Date.now();
    set({
      oneClickProgress: {
        stage: 'completed',
        percent: 100,
        message: 'One-click concluído com sucesso.'
      },
      oneClickTimeline: appendTimeline(get().oneClickTimeline, {
        ts: completedAt,
        percent: 100
      }),
      liveEvents: appendEvent(get().liveEvents, 'one-click', 'One-click concluido com sucesso')
    });
  },
  resetPlatform: async () => {
    // Resetar estado local (sem chamar API para evitar crash)
    set({
      images: [],
      totalImages: 0,
      discardedImages: 0,
      warnings: [],
      searchProgress: null,
      downloadProgress: null,
      oneClickProgress: {
        stage: 'idle',
        percent: 0,
        message: ''
      },
      downloadStats: null,
      error: null,
      loading: false,
      searchTimeline: [],
      downloadTimeline: [],
      oneClickTimeline: [],
      liveEvents: appendEvent(get().liveEvents, 'system', 'Plataforma resetada')
    });
  }
}));
