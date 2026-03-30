import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { DownloadRecord } from './types.js';

type HistoryRow = {
  id: number;
  filename: string;
  user: string;
  url: string;
  url_hash: string;
  download_date: string;
  path: string;
  status: string;
};

let db: Database.Database | null = null;

function resolveDbPath(): string {
  const dbPath = process.env.DB_PATH;
  if (dbPath) {
    return dbPath;
  }

  const folder = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, 'downloads.sqlite');
}

function initDb(): Database.Database {
  const instance = new Database(resolveDbPath());
  instance.pragma('journal_mode = WAL');
  instance.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      user TEXT NOT NULL,
      url TEXT UNIQUE NOT NULL,
      url_hash TEXT NOT NULL,
      download_date TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_downloads_url_hash ON downloads(url_hash);
    CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
  `);
  return instance;
}

function getDb(): Database.Database {
  if (!db) {
    db = initDb();
  }
  return db;
}

export function findDownloadByHash(urlHash: string): HistoryRow | undefined {
  return getDb()
    .prepare("SELECT * FROM downloads WHERE url_hash = ? AND status = 'active' LIMIT 1")
    .get(urlHash) as HistoryRow | undefined;
}

export function upsertDownload(record: DownloadRecord): void {
  getDb()
    .prepare(
      `
      INSERT INTO downloads (filename, user, url, url_hash, download_date, path, status)
      VALUES (@filename, @user, @url, @urlHash, @downloadDate, @path, @status)
      ON CONFLICT(url) DO UPDATE SET
        filename = excluded.filename,
        user = excluded.user,
        url_hash = excluded.url_hash,
        download_date = excluded.download_date,
        path = excluded.path,
        status = excluded.status
    `,
    )
    .run(record);
}

export function listHistory(limit = 1000): HistoryRow[] {
  return getDb()
    .prepare('SELECT * FROM downloads ORDER BY id DESC LIMIT ?')
    .all(limit) as HistoryRow[];
}

export function clearHistory(): number {
  return getDb().prepare('DELETE FROM downloads').run().changes;
}

export function exportHistoryCsv(): string {
  const rows = listHistory(10000);
  const header = 'filename,user,url,download_date,path,status';
  const lines = rows.map((row) =>
    [row.filename, row.user, row.url, row.download_date, row.path, row.status]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
}
