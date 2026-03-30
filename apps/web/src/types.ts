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
