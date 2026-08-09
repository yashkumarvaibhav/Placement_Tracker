import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The API tests exercise routing, auth gates, and request validation with the data layer
// stubbed out — no database is touched.
// Google verification is stubbed: the "credential" is just a JSON payload the test controls.
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken({ idToken }) {
      const payload = JSON.parse(idToken);
      return { getPayload: () => payload };
    }
  },
}));

vi.mock('../src/db.js', () => ({
  countCompanyReferences: vi.fn(async () => ({ offers: 0, students: 0 })),
  findPlacementRosterStudent: vi.fn(async () => null),
  getAccessRequest: vi.fn(async () => null),
  recordAccessRequest: vi.fn(async ({ email, name }) => ({ id: 1, email, name, status: 'pending' })),
  listAccessRequests: vi.fn(async () => []),
  setAccessRequestStatus: vi.fn(async (id, status) => ({ id, email: 'someone@iiitd.ac.in', status })),
  createCompany: vi.fn(async (payload) => ({ id: 1, ...payload })),
  createPlacementCalendarSnapshot: vi.fn(),
  createStudent: vi.fn(async (payload) => ({ id: 1, ...payload })),
  deleteCompany: vi.fn(async () => {}),
  deleteStudent: vi.fn(async () => {}),
  diffPlacementCalendarSnapshots: vi.fn(),
  getAppSettings: vi.fn(async () => ({})),
  getCompany: vi.fn(async () => undefined),
  getLatestPlacementCalendarSnapshot: vi.fn(),
  getMySkillRatings: vi.fn(async () => []),
  getPlacementCalendarCellHistory: vi.fn(),
  getPlacementCalendarSnapshot: vi.fn(),
  getPreviousPlacementCalendarSnapshotId: vi.fn(),
  getRatingViewerContext: vi.fn(async () => null),
  getSkillRatingAnalytics: vi.fn(async () => ({
    summary: { total_ratings: 0, participating_raters: 0, students_rated: 0 },
    ratings: [],
  })),
  getStudent: vi.fn(async () => undefined),
  getTableCounts: vi.fn(async () => ({ companies: 0, students: 0, offers: 0 })),
  listCompanies: vi.fn(async () => []),
  listCompaniesByCycle: vi.fn(async () => [{ id: 7, name: 'Acme' }]),
  listPlacementCalendarSnapshots: vi.fn(),
  listStudents: vi.fn(async () => []),
  listStudentsByCycle: vi.fn(async () => []),
  setAppSettings: vi.fn(async () => {}),
  saveSkillRating: vi.fn(async (_email, targetStudentId, ratings) => ({
    created: true,
    rating: { target_student_id: targetStudentId, ...ratings },
  })),
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
const { SESSION_SECRET } = await import('../src/config.js');
const { invalidateGrant } = await import('../src/access.js');
const db = await import('../src/db.js');

// The signing key is a real Google account on the 2027 roster unless a test says otherwise.
const googleCredential = (payload) => JSON.stringify({
  email_verified: true,
  hd: 'iiitd.ac.in',
  ...payload,
});
const signInWith = (payload, ip = '198.51.100.1') => request(app)
  .post('/api/auth/google')
  .set('X-Forwarded-For', ip)
  .send({ credential: googleCredential(payload) });

const asViewer = () => `Bearer ${createViewerSession('viewer25001@iiitd.ac.in')}`;
const asAdmin = () => `Bearer ${createAdminSession()}`;

// Mints a token the way the retired shared username/password login used to, so the tests can
// prove those sessions no longer open any door.
const asRetiredSharedViewer = () => {
  const payload = Buffer.from(JSON.stringify({
    type: 'viewer',
    auth_source: 'shared',
    expires_at: Date.now() + 60_000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `Bearer ${payload}.${signature}`;
};

beforeEach(() => {
  setDbReady(true);
  invalidateGrant();
  vi.clearAllMocks();
  // Sitting on the roster is no longer a grant, so signed-in viewers in the existing tests
  // are addresses an admin approved.
  db.getAccessRequest.mockResolvedValue({ id: 5, email: 'viewer25001@iiitd.ac.in', status: 'approved' });
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

  it('rejects sessions from the retired shared viewer login even before they expire', async () => {
    const res = await request(app)
      .get('/api/students?cycle=2027')
      .set('Authorization', asRetiredSharedViewer());
    expect(res.status).toBe(401);
  });

  it('no longer accepts a viewer username and password', async () => {
    const res = await request(app)
      .post('/api/auth/viewer')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ username: 'guest@placement-atlas', password: 'whatever-it-used-to-be' });
    expect(res.status).toBe(410);
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

describe('skill ratings privacy and update policy', () => {
  const asGoogleViewer = () => `Bearer ${createViewerSession('peer25001@iiitd.ac.in')}`;

  it('normalizes the signed-in viewer identity to the student id expected by the rating UI', async () => {
    db.getRatingViewerContext.mockResolvedValueOnce({
      student_id: 423,
      name: 'Yash Kumar Vaibhav',
      roll_number: 'MT25091',
    });
    const res = await request(app)
      .get('/api/auth/session')
      .set('Authorization', asGoogleViewer());
    expect(res.status).toBe(200);
    expect(res.body.self_student).toEqual(expect.objectContaining({
      id: 423,
      name: 'Yash Kumar Vaibhav',
    }));
  });

  it('does not let an unidentifiable legacy session submit ratings', async () => {
    const res = await request(app)
      .put('/api/ratings/1')
      .set('Authorization', asRetiredSharedViewer())
      .send({ overall: 8, dsa: 9, ml: 7 });
    expect(res.status).toBe(401);
    expect(db.saveSkillRating).not.toHaveBeenCalled();
  });

  it('validates all three scores as whole numbers from 1 to 10', async () => {
    const res = await request(app)
      .put('/api/ratings/1')
      .set('Authorization', asGoogleViewer())
      .send({ overall: 8, dsa: 11, ml: 7 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/DSA rating/);
  });

  it('submits attributable ratings without exposing the email in the response', async () => {
    db.getStudent.mockResolvedValueOnce({ id: 1, name: 'Batchmate' });
    const res = await request(app)
      .put('/api/ratings/1')
      .set('Authorization', asGoogleViewer())
      .send({ overall: 8, dsa: 9, ml: 7 });
    expect(res.status).toBe(201);
    expect(db.saveSkillRating).toHaveBeenCalledWith(
      'peer25001@iiitd.ac.in',
      1,
      { overall: 8, dsa: 9, ml: 7 },
      { confirmUpdate: false }
    );
    expect(res.body).not.toHaveProperty('rater_email');
  });

  it('keeps attribution analytics admin-only', async () => {
    expect((await request(app)
      .get('/api/ratings/analytics')
      .set('Authorization', asGoogleViewer())).status).toBe(401);

    const res = await request(app)
      .get('/api/ratings/analytics')
      .set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(db.getSkillRatingAnalytics).toHaveBeenCalledTimes(1);
  });

  it('passes explicit update confirmation to the data layer', async () => {
    db.getStudent.mockResolvedValueOnce({ id: 1, name: 'Batchmate' });
    db.saveSkillRating.mockResolvedValueOnce({
      created: false,
      rating: { target_student_id: 1, overall: 6, dsa: 7, ml: 8 },
    });
    const res = await request(app)
      .put('/api/ratings/1')
      .set('Authorization', asGoogleViewer())
      .send({ overall: 6, dsa: 7, ml: 8, confirm_update: true });
    expect(res.status).toBe(200);
    expect(db.saveSkillRating).toHaveBeenCalledWith(
      'peer25001@iiitd.ac.in',
      1,
      { overall: 6, dsa: 7, ml: 8 },
      { confirmUpdate: true }
    );
  });

  it('returns a confirmation-required conflict when an existing rating is changed silently', async () => {
    db.getStudent.mockResolvedValueOnce({ id: 1, name: 'Batchmate' });
    const confirmationError = new Error('Confirm before changing an existing rating.');
    confirmationError.code = 'RATING_CONFIRMATION_REQUIRED';
    db.saveSkillRating.mockRejectedValueOnce(confirmationError);
    const res = await request(app)
      .put('/api/ratings/1')
      .set('Authorization', asGoogleViewer())
      .send({ overall: 6, dsa: 7, ml: 8 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({ confirmation_required: true }));
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

describe('who is allowed to sign in', () => {
  it('turns away non-institute accounts without queueing a request', async () => {
    const res = await signInWith({ email: 'someone@gmail.com', hd: undefined });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOMAIN_NOT_ALLOWED');
    expect(db.recordAccessRequest).not.toHaveBeenCalled();
  });

  it('turns away an institute address whose Google account is unverified', async () => {
    const res = await signInWith({ email: 'someone@iiitd.ac.in', email_verified: false });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('lets the whitelisted account in without consulting the roster', async () => {
    db.getAccessRequest.mockResolvedValue(null);
    const res = await signInWith({ email: 'vaibhav25006@iiitd.ac.in' });
    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
    expect(res.body.token).toBeTruthy();
    expect(db.findPlacementRosterStudent).not.toHaveBeenCalled();
  });

  it('no longer admits the partner account that used to be whitelisted', async () => {
    db.getAccessRequest.mockResolvedValue(null);
    const res = await signInWith({ email: 'dharnish@knowledgechakra.com', hd: undefined });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('no longer admits a Placement Cell address on sight', async () => {
    db.getAccessRequest.mockResolvedValue(null);
    const res = await signInWith({ email: 'admin-placement@iiitd.ac.in' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_PENDING');
  });

  it('no longer auto-approves a student sitting in the placement process', async () => {
    db.getAccessRequest.mockResolvedValue(null);
    const res = await signInWith({ email: 'sanjeet23482@iiitd.ac.in' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_PENDING');
    expect(db.findPlacementRosterStudent).not.toHaveBeenCalled();
  });

  it('queues any other institute address for admin approval', async () => {
    db.getAccessRequest.mockResolvedValue(null);
    const res = await signInWith({ email: 'alumni20123@iiitd.ac.in', name: 'Alum' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_PENDING');
    expect(db.recordAccessRequest).toHaveBeenCalledWith({ email: 'alumni20123@iiitd.ac.in', name: 'Alum' });
  });

  it('lets an approved request through', async () => {
    db.getAccessRequest.mockResolvedValue({ id: 3, email: 'faculty@iiitd.ac.in', status: 'approved' });
    const res = await signInWith({ email: 'faculty@iiitd.ac.in' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('keeps a denied request out and says so', async () => {
    db.getAccessRequest.mockResolvedValue({ id: 3, email: 'nope@iiitd.ac.in', status: 'denied' });
    db.recordAccessRequest.mockResolvedValue({ id: 3, email: 'nope@iiitd.ac.in', status: 'denied' });
    const res = await signInWith({ email: 'nope@iiitd.ac.in' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('signs the admin in as an admin', async () => {
    const res = await signInWith({ email: 'yash25091@iiitd.ac.in' });
    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(true);
  });
});

describe('access stays revocable after sign-in', () => {
  it('stops serving data once the grant is gone', async () => {
    db.getAccessRequest.mockResolvedValue(null);
    db.getAccessRequest.mockResolvedValue({ status: 'denied' });
    const res = await request(app)
      .get('/api/companies?cycle=2027')
      .set('Authorization', asViewer());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_REVOKED');
  });

  it('keeps the admin session working without a roster lookup', async () => {
    db.getAccessRequest.mockResolvedValue(null);
    const res = await request(app).get('/api/companies?cycle=2027').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
  });
});

describe('access request queue', () => {
  it('is admin-only', async () => {
    expect((await request(app).get('/api/admin/access-requests')).status).toBe(401);
    expect((await request(app).get('/api/admin/access-requests').set('Authorization', asViewer())).status).toBe(401);
  });

  it('lists requests for an admin', async () => {
    db.listAccessRequests.mockResolvedValue([{ id: 1, email: 'a@iiitd.ac.in', status: 'pending' }]);
    const res = await request(app).get('/api/admin/access-requests').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('rejects a status it does not recognise', async () => {
    const res = await request(app)
      .put('/api/admin/access-requests/1')
      .set('Authorization', asAdmin())
      .send({ status: 'maybe' });
    expect(res.status).toBe(400);
    expect(db.setAccessRequestStatus).not.toHaveBeenCalled();
  });

  it('approves a request and records who decided it', async () => {
    db.setAccessRequestStatus.mockResolvedValue({ id: 1, email: 'a@iiitd.ac.in', status: 'approved' });
    const res = await request(app)
      .put('/api/admin/access-requests/1')
      .set('Authorization', asAdmin())
      .send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(db.setAccessRequestStatus).toHaveBeenCalledWith('1', 'approved', 'yash25091@iiitd.ac.in');
  });

  it('404s an unknown request', async () => {
    db.setAccessRequestStatus.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/admin/access-requests/999')
      .set('Authorization', asAdmin())
      .send({ status: 'denied' });
    expect(res.status).toBe(404);
  });
});

describe('auth rate limiting', () => {
  it('throttles repeated sign-in attempts from one client', async () => {
    let lastStatus = null;
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/auth/google')
        .set('X-Forwarded-For', '203.0.113.99')
        .send({ credential: 'not-a-real-google-credential' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
