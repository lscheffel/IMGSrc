import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '../src/App';
import { useScraperStore } from '../src/store/useScraperStore';

describe('App mission control', () => {
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
      selectedPreset: 'balanced',
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
  });

  it('navega entre workspaces', () => {
    render(<App />);

    expect(screen.getByText('IMGSrc Command Center')).toBeTruthy();
    fireEvent.click(screen.getByText('Search Studio'));
    expect(screen.getByText('Parametros de Busca')).toBeTruthy();

    fireEvent.click(screen.getByText('Download Control'));
    expect(screen.getByText('Parametros de Download')).toBeTruthy();
  });
});
