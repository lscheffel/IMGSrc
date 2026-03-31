import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createServer } from '../src/server.js';

describe('API smoke contract', () => {
  const app = createServer();

  it('returns health status', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('rejects invalid scrape payload', async () => {
    const response = await request(app).post('/api/scrape').send({ urls: [] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_payload');
  });

  it('creates and reads async download job', async () => {
    const create = await request(app).post('/api/jobs/download').send({
      images: [],
      destFolder: './results',
      overwrite: false,
      createUserFolder: true,
      createAlbumFolder: true,
      downloadsParallel: 1
    });
    expect(create.status).toBe(202);
    expect(create.body.jobId).toBeTypeOf('string');

    const details = await request(app).get(`/api/jobs/download/${create.body.jobId}`);
    expect(details.status).toBe(200);
    expect(['queued', 'running', 'completed', 'failed']).toContain(details.body.status);
    expect(details.body.progress).toBeDefined();
  });

  it('creates and reads async scrape job', async () => {
    const create = await request(app).post('/api/jobs/scrape').send({
      urls: ['https://imgsrc.ru/mathiasw/86803498.html'],
      minSizeKb: 10,
      scrapeThreads: 1,
      urlWorkers: 1
    });
    expect(create.status).toBe(202);
    expect(create.body.jobId).toBeTypeOf('string');

    const details = await request(app).get(`/api/jobs/scrape/${create.body.jobId}`);
    expect(details.status).toBe(200);
    expect(['queued', 'running', 'completed', 'failed']).toContain(details.body.status);
    expect(details.body.progress).toBeDefined();
  });

  it('exposes metrics snapshot endpoint', async () => {
    await request(app).get('/api/health');
    const response = await request(app).get('/api/metrics');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.endpoints)).toBe(true);
    expect(response.body.queue).toBeDefined();
  });
});
