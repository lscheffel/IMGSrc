import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseUrls, useScraperStore } from '../src/store/useScraperStore';
import type { ScrapeResponse } from '../src/types';

const apiMocks = vi.hoisted(() => ({
  scrape: vi.fn(),
  download: vi.fn()
}));

vi.mock('../src/lib/api', () => ({
  scrape: apiMocks.scrape,
  download: apiMocks.download
}));

describe('useScraperStore', () => {
  beforeEach(() => {
    useScraperStore.setState({
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
      searchLive: {
        startedAt: null,
        updatedAt: null,
        elapsedSec: 0,
        pagesPerSec: 0,
        validPerSec: 0,
        etaSec: null
      },
      downloadLive: {
        startedAt: null,
        updatedAt: null,
        elapsedSec: 0,
        filesPerSec: 0,
        mbPerSec: 0,
        etaSec: null
      },
      liveEvents: [],
      oneClickProgress: {
        stage: 'idle',
        percent: 0,
        message: ''
      },
      downloadStats: null,
      error: null
    });
    apiMocks.scrape.mockReset();
    apiMocks.download.mockReset();
  });

  it('carrega imagens na busca', async () => {
    const payload: ScrapeResponse = {
      images: [{ url: 'https://imgsrc.ru/a.webp', size: 2048, user: 'u', title: 't' }],
      totalImages: 1,
      discardedImages: 0
    };
    apiMocks.scrape.mockResolvedValue(payload);

    useScraperStore.setState({ urlsInput: 'https://imgsrc.ru/a/1.html' });
    await useScraperStore.getState().runSearch();

    expect(useScraperStore.getState().images).toHaveLength(1);
    expect(useScraperStore.getState().error).toBeNull();
  });

  it('parseia urls por linha e virgula', () => {
    expect(parseUrls('a,b\nc')).toEqual(['a', 'b', 'c']);
  });
});
