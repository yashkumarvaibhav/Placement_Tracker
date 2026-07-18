import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The API tests exercise routing, auth gates, and request validation with the data layer
// stubbed out — no database is touched.
vi.mock('../src/db.js', () => ({
  countCompanyReferences: vi.fn(async () => ({ offers: 0, students: 0 })),
  createCompany: vi.fn(async (payload) => ({ id: 1, ...payload })),
  createPlacementCalendarSnapshot: vi.fn(),
  createStudent: vi.fn(async (payload) => ({ id: 1, ...payload })),
  deleteCompany: vi.fn(async () => {}),
  deleteStudent: vi.fn(async () => {}),
  diffPlacementCalendarSnapshots: vi.fn(),
  getAppSettings: vi.fn(async () => ({})),
  getCompany: vi.fn(async () => undefined),
  getLatestPlacementCalendarSnapshot: vi.fn(),
  getPlacementCalendarCellHistory: vi.fn(),
  getPlacementCalendarSnapshot: vi.fn(),
  getPreviousPlacementCalendarSnapshotId: vi.fn(),
  getStudent: vi.fn(async () => undefined),
  getTableCounts: vi.fn(async () => ({ companies: 0, students: 0, offers: 0 })),
  listCompanies: vi.fn(async () => []),
  listCompaniesByCycle: vi.fn(async () => [{ id: 7, name: 'Acme' }]),
  listPlacementCalendarSnapshots: vi.fn(),
  listStudents: vi.fn(async () => []),
  listStudentsByCycle: vi.fn(async () => []),
  setAppSettings: vi.fn(async () => {}),
  updateCompany: vi.fn(async (id, payload) => ({ id, ...payload })),
  updateStudent: vi.fn(async (id, payload) => ({ id, ...payload })),
  addOfferToStudent: vi.fn(async () => ({})),
  convertOfferToPpo: vi.fn(async () => ({})),
  buildStats: vi.fn(async () => ({ total_students: 0 })),
  initDb: vi.fn(),
  ensureOfferBackfill: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  runOn: vi.fn(),
  closeDb: vi.fn(),
}));

const { default: app } = await import('../src/app.js');
const { createAdminSession, createViewerSession } = await import('../src/auth.js');
const { setDbReady } = await import('../src/ready.js');
const db = await import('../src/db.js');

const asViewer = () => `Bearer ${createViewerSession()}`;
const asAdmin = () => `Bearer ${createAdminSession()}`;

beforeEach(() => {
  setDbReady(true);
  vi.clearAllMocks();
});

describe('login wall on data routes', () => {
  it.each([
    '/api/students?cycle=2027',
    '/api/companies?cycle=2027',
    '/api/stats?cycle=2027',
    '/api/students/1',
    '/api/companies/1',
  ])('%s rejects anonymous requests', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it('rejects tampered tokens', async () => {
    const forged = `${asViewer()}x`;
    const res = await request(app).get('/api/students?cycle=2027').set('Authorization', forged);
    expect(res.status).toBe(401);
  });

  it('serves data to a signed-in viewer', async () => {
    const res = await request(app).get('/api/companies?cycle=2027').set('Authorization', asViewer());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 7, name: 'Acme' }]);
  });

  it('keeps write routes admin-only (viewer token is not enough)', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', asViewer())
      .send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('allows admin writes', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', asAdmin())
      .send({ name: 'X', batch_key: 'btech-2027' });
    expect(res.status).toBe(201);
  });
});

describe('request validation policy', () => {
  it('rejects a PPO conversion without a positive CTC', async () => {
    const res = await request(app)
      .post('/api/offers/12/convert-to-ppo')
      .set('Authorization', asAdmin())
      .send({ ctc: 0 });
    expect(res.status).toBe(400);
    expect(db.convertOfferToPpo).not.toHaveBeenCalled();
  });

  it('accepts a PPO conversion with a CTC and passes it through', async () => {
    const res = await request(app)
      .post('/api/offers/12/convert-to-ppo')
      .set('Authorization', asAdmin())
      .send({ ctc: 2500000, role: 'SDE' });
    expect(res.status).toBe(200);
    expect(db.convertOfferToPpo).toHaveBeenCalledWith('12', expect.objectContaining({ ctc: 2500000, role: 'SDE' }));
  });

  it('rejects a placed student whose company is from a different cycle', async () => {
    db.getCompany.mockResolvedValueOnce({ id: 5, graduation_year: 2026 });
    const res = await request(app)
      .post('/api/students')
      .set('Authorization', asAdmin())
      .send({
        placement_status: 'Placed',
        offers: [{ company_id: 5 }],
        batch_key: 'btech-2027',
        graduation_year: 2027,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/different placement cycle/);
  });

  it('accepts a placed student whose company is stored under the other degree of the same cycle', async () => {
    db.getCompany.mockResolvedValueOnce({ id: 5, batch_key: 'btech-2027', graduation_year: 2027 });
    const res = await request(app)
      .post('/api/students')
      .set('Authorization', asAdmin())
      .send({
        placement_status: 'Placed',
        offers: [{ company_id: 5 }],
        batch_key: 'mtech-2027',
        graduation_year: 2027,
      });
    expect(res.status).toBe(201);
  });

  it('refuses to delete a company that is still referenced', async () => {
    db.countCompanyReferences.mockResolvedValueOnce({ offers: 3, students: 1 });
    const res = await request(app)
      .delete('/api/companies/9')
      .set('Authorization', asAdmin());
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/3 student offers and 1 student record/);
    expect(db.deleteCompany).not.toHaveBeenCalled();
  });
});

describe('operational endpoints', () => {
  it('public health exposes no infrastructure details', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('admin health exposes table counts to admins only', async () => {
    expect((await request(app).get('/api/admin/health')).status).toBe(401);
    const res = await request(app).get('/api/admin/health').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.counts).toBeDefined();
  });

  it('unknown API routes return JSON 404', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
  });
});

describe('auth rate limiting', () => {
  it('throttles repeated viewer sign-in attempts from one client', async () => {
    let lastStatus = null;
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/auth/viewer')
        .set('X-Forwarded-For', '203.0.113.99')
        .send({ username: 'nope', password: 'wrong-password' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
