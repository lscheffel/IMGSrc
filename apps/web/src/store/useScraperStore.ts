import { create } from 'zustand';

import { download, scrape } from '../lib/api';
import type { DownloadResponse, ScrapeResponse, ScrapedImage } from '../types';

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
  downloadStats: DownloadResponse | null;
  error: string | null;
  setField: <K extends keyof ScraperState>(field: K, value: ScraperState[K]) => void;
  runSearch: () => Promise<void>;
  runDownload: () => Promise<void>;
  runOneClick: () => Promise<void>;
};

export function parseUrls(input: string): string[] {
  return input
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  downloadStats: null,
  error: null,
  setField: (field, value) => set({ [field]: value } as Partial<ScraperState>),
  runSearch: async () => {
    const state = get();
    const urls = parseUrls(state.urlsInput);
    if (!urls.length) {
      set({ error: 'Informe ao menos uma URL válida.' });
      return;
    }
    set({ loading: true, error: null, downloadStats: null, warnings: [] });
    try {
      const result: ScrapeResponse = await scrape({
        urls,
        minSizeKb: state.minSizeKb,
        scrapeThreads: state.scrapeThreads,
        urlWorkers: state.urlWorkers
      });
      set({
        images: result.images,
        totalImages: result.totalImages,
        discardedImages: result.discardedImages,
        warnings: result.warnings ?? []
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Erro na busca.',
        warnings: []
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
    set({ loading: true, error: null });
    try {
      const result = await download({
        images: state.images,
        destFolder: state.destFolder,
        overwrite: state.overwrite,
        createUserFolder: state.createUserFolder,
        createAlbumFolder: state.createAlbumFolder,
        downloadsParallel: state.downloadsParallel
      });
      set({ downloadStats: result });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Erro no download.' });
    } finally {
      set({ loading: false });
    }
  },
  runOneClick: async () => {
    await get().runSearch();
    if (get().images.length > 0) {
      await get().runDownload();
    }
  }
}));
