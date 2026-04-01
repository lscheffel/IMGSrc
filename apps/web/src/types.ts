export type ScrapedImage = {
  url: string;
  size: number;
  user: string;
  title: string;
};

export type ScrapeResponse = {
  images: ScrapedImage[];
  totalImages: number;
  discardedImages: number;
  warnings?: string[];
};

export type DownloadResponse = {
  totalDownloads: number;
  totalMb: number;
  skipped: number;
  errors: number;
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

export type HistoryRecord = {
  id: number;
  filename: string;
  user: string;
  url: string;
  url_hash: string;
  download_date: string;
  path: string;
  status: string;
};

export type HistoryPageResponse = {
  items: HistoryRecord[];
  nextCursor: number | null;
};
