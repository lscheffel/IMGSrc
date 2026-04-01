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

export type DownloadRecord = {
  filename: string;
  user: string;
  url: string;
  urlHash: string;
  downloadDate: string;
  path: string;
  status: 'active' | 'deleted';
};
