import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The takedown switch is read from the environment when config.js first loads, so each block
// stubs SITE_TAKEDOWN and re-imports the app to get a server built with that setting.
const loadApp = async (takedown) => {
  vi.resetModules();
  vi.stubEnv('SITE_TAKEDOWN', takedown);
  return (await import('../src/app.js')).default;
};

const RETIRED = 'placement-atlas.yashkumarvaibhav.me';
const APP = 'kajukatli.yashkumarvaibhav.me';
const PORTFOLIO = 'yashkumarvaibhav.me';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('retired hostname', () => {
  let app;

  beforeEach(async () => {
    // Off: the retired host is suspended on its own, not because the switch is on.
    app = await loadApp('off');
  });

  it('answers every path with the notice, not the app', async () => {
    for (const path of ['/', '/students', '/admin', '/assets/index.js', '/favicon.svg']) {
      const res = await request(app).get(path).set('Host', RETIRED);
      expect(res.status).toBe(503);
      expect(res.text).toContain('This website has been taken down.');
    }
  });

  it('suspends its API and its sign-in', async () => {
    const batches = await request(app).get('/api/batches').set('Host', RETIRED);
    expect(batches.status).toBe(503);
    expect(batches.body.message).toContain('taken down');

    const signIn = await request(app)
      .post('/api/auth/google')
      .set('Host', RETIRED)
      .send({ credential: 'anything' });
    expect(signIn.status).toBe(503);
  });

  it('names neither the old product nor the new hostname, so the move is not advertised', async () => {
    const res = await request(app).get('/').set('Host', RETIRED);
    expect(res.text).not.toContain('Placement Atlas');
    expect(res.text).not.toContain('Kaju Katli');
    expect(res.text).not.toContain('kajukatli');
  });

  it('sends the reader to the portfolio', async () => {
    const res = await request(app).get('/').set('Host', RETIRED);
    expect(res.text).toContain('https://yashkumarvaibhav.me');
  });

  it('is not cached', async () => {
    const res = await request(app).get('/').set('Host', RETIRED);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps the legacy /Placement_Tracker link on the notice rather than forwarding it', async () => {
    const res = await request(app).get('/Placement_Tracker/').set('Host', PORTFOLIO);
    expect(res.status).toBe(503);
    expect(res.text).not.toContain('kajukatli');
  });
});

describe('live hostname', () => {
  let app;

  beforeEach(async () => {
    app = await loadApp('off');
  });

  it('serves the API', async () => {
    const res = await request(app).get('/api/batches').set('Host', APP);
    expect(res.status).toBe(200);
  });

  it('serves the API to callers with no public hostname too', async () => {
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(200);
  });

  it('leaves the portfolio host serving the portfolio', async () => {
    const res = await request(app).get('/').set('Host', PORTFOLIO);
    expect(res.status).not.toBe(503);
  });
});

describe('SITE_TAKEDOWN switched on', () => {
  let app;

  beforeEach(async () => {
    app = await loadApp('on');
  });

  it('suspends the live hostname and the API as well', async () => {
    expect((await request(app).get('/').set('Host', APP)).status).toBe(503);
    expect((await request(app).get('/api/batches').set('Host', APP)).status).toBe(503);
  });

  it('still leaves the portfolio up', async () => {
    const res = await request(app).get('/').set('Host', PORTFOLIO);
    expect(res.status).not.toBe(503);
  });

  it('keeps the loopback liveness probe up so the supervisor does not restart-loop', async () => {
    const res = await request(app).get('/healthz').set('Host', '127.0.0.1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', takedown: true });
  });

  it('hides the liveness probe on a public hostname', async () => {
    const res = await request(app).get('/healthz').set('Host', RETIRED);
    expect(res.status).toBe(503);
  });
});
