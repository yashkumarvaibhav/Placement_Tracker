import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The takedown gate is read from the environment when config.js first loads, so each block
// stubs SITE_TAKEDOWN and re-imports the app to get a server built with that setting.
const loadApp = async (takedown) => {
  vi.resetModules();
  vi.stubEnv('SITE_TAKEDOWN', takedown);
  return (await import('../src/app.js')).default;
};

const ATLAS = 'placement-atlas.yashkumarvaibhav.me';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('site takedown', () => {
  let app;

  beforeEach(async () => {
    app = await loadApp('on');
  });

  it('replaces the landing page with the notice', async () => {
    const res = await request(app).get('/').set('Host', ATLAS);
    expect(res.status).toBe(503);
    expect(res.text).toContain('This website has been taken down.');
    expect(res.text).toContain('https://yashkumarvaibhav.me');
  });

  it('covers every route on the tracker host, not just the landing page', async () => {
    for (const path of ['/students', '/admin', '/assets/index.js', '/favicon.svg']) {
      const res = await request(app).get(path).set('Host', ATLAS);
      expect(res.status).toBe(503);
    }
  });

  it('suspends the API on every hostname', async () => {
    for (const host of [ATLAS, 'yashkumarvaibhav.me']) {
      const res = await request(app).get('/api/batches').set('Host', host);
      expect(res.status).toBe(503);
      expect(res.body.message).toContain('taken down');
    }
  });

  it('suspends sign-in', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .set('Host', ATLAS)
      .send({ credential: 'anything' });
    expect(res.status).toBe(503);
  });

  it('is not cached, so the site can come back cleanly', async () => {
    const res = await request(app).get('/').set('Host', ATLAS);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps the loopback liveness probe up so the supervisor does not restart-loop', async () => {
    const res = await request(app).get('/healthz').set('Host', '127.0.0.1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', takedown: true });
  });

  it('hides the liveness probe on the public hostname', async () => {
    const res = await request(app).get('/healthz').set('Host', ATLAS);
    expect(res.status).toBe(503);
    expect(res.text).toContain('This website has been taken down.');
  });

  it('leaves the portfolio host serving the portfolio', async () => {
    const res = await request(app).get('/').set('Host', 'yashkumarvaibhav.me');
    expect(res.status).not.toBe(503);
    expect(res.text || '').not.toContain('This website has been taken down.');
  });
});

describe('site takedown switched off', () => {
  it('serves the API again', async () => {
    const app = await loadApp('off');
    const res = await request(app).get('/api/batches').set('Host', ATLAS);
    expect(res.status).toBe(200);
  });
});
