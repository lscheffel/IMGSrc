import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { findDownloadByHash, upsertDownload } from '../src/db.js';

describe('db active filter', () => {
  it('finds row when status is active literal', () => {
    const id = randomUUID();
    const url = `https://imgsrc.ru/test/${id}.webp`;
    const hash = `hash_${id}`;

    upsertDownload({
      filename: `${id}.webp`,
      user: 'tester',
      url,
      urlHash: hash,
      downloadDate: '2026-03-30 12:00:00',
      path: `./results/${id}.webp`,
      status: 'active'
    });

    const row = findDownloadByHash(hash);
    expect(row?.url).toBe(url);
    expect(row?.status).toBe('active');
  });
});

