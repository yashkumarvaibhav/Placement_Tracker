import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { OAuth2Client } from 'google-auth-library';
import argon2 from 'argon2';
import { BATCHES, getBatchConfig } from './batches.js';
import {
  buildStats,
  createCompany,
  createStudent,
  deleteCompany,
  deleteStudent,
  ensureOfferBackfill,
  getAppSettings,
  getTableCounts,
  getCompany,
  getStudent,
  initDb,
  listCompanies,
  listCompaniesByCycle,
  listStudents,
  listStudentsByCycle,
  addOfferToStudent,
  setAppSettings,
  updateCompany,
  updateStudent,
} from './db.js';

const ADMIN_EMAIL = 'yash25091@iiitd.ac.in';
const DEFAULT_VIEWER_USERNAME = process.env.VIEWER_USERNAME || 'guest@placement-atlas';
const DEFAULT_VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '183667160330-4jtc41mg2jf7ugk6211smgcrr7lcfo02.apps.googleusercontent.com';
const PLACEMENT_ATLAS_HOST = process.env.PLACEMENT_ATLAS_HOST || 'placement-atlas.yashkumarvaibhav.me';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const VIEWER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PORT = process.env.PORT || 4000;
const frontendDistPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../frontend/dist',
);
const portfolioDistPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../portfolio-site/dist',
);

const app = express();
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set; viewer sessions will reset when the server restarts.');
}

app.use(cors({
  origin: [
    `https://${PLACEMENT_ATLAS_HOST}`,
    'https://yashkumarvaibhav.me',
    'http://localhost:5173',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

let isDbReady = false;

const resolveBatchKey = (batchKey) => getBatchConfig(batchKey).key;
const withResolvedBatch = (req) => ({
  ...req.body,
  batch_key: req.body?.batch_key || resolveBatchKey(req.query.batch),
});

const requireDbReady = (_req, res, next) => {
  if (isDbReady) return next();
  return res.status(503).json({ message: 'Server is warming up. Please retry shortly.' });
};

const encodeSessionPart = (value) => Buffer.from(value).toString('base64url');

const createSignedSession = (session) => {
  const payload = encodeSessionPart(JSON.stringify(session));
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

const readSignedSession = (token) => {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;

  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const createViewerSession = () => createSignedSession({
  type: 'viewer',
  expires_at: Date.now() + VIEWER_SESSION_TTL_MS,
});

const createAdminSession = () => createSignedSession({
  type: 'admin',
  auth_source: 'google',
  subject: 'primary-admin',
});

const isValidViewerSession = (token) => {
  const session = readSignedSession(token);
  return session?.type === 'viewer' && Number(session.expires_at) > Date.now();
};

const isValidAdminSession = (token) => {
  const session = readSignedSession(token);
  return session?.type === 'admin'
    && session.auth_source === 'google'
    && session.subject === 'primary-admin';
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const hashPassword = (password) => argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
});

const verifyLegacyScryptPassword = (password, storedHash) => {
  const [algorithm, salt, expectedHash] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHash) return false;

  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'base64url');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const verifyPassword = async (password, storedHash) => {
  if (String(storedHash).startsWith('$argon2id$')) {
    return argon2.verify(storedHash, password);
  }
  return verifyLegacyScryptPassword(password, storedHash);
};

const getViewerCredentials = async () => {
  const settings = await getAppSettings(['viewer_username', 'viewer_password_hash']);
  return {
    username: settings.viewer_username || DEFAULT_VIEWER_USERNAME,
    passwordHash: settings.viewer_password_hash || '',
  };
};

const ensureDefaultViewerCredentials = async () => {
  const settings = await getAppSettings(['viewer_username', 'viewer_password_hash']);
  const defaults = {};

  if (!settings.viewer_username) defaults.viewer_username = DEFAULT_VIEWER_USERNAME;
  if (!settings.viewer_password_hash && DEFAULT_VIEWER_PASSWORD) {
    defaults.viewer_password_hash = await hashPassword(DEFAULT_VIEWER_PASSWORD);
  }

  await setAppSettings(defaults);
};

const bearerToken = (req) => {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
};

const requireViewerAuth = (req, res, next) => {
  const token = bearerToken(req);
  if (isValidAdminSession(token) || isValidViewerSession(token)) return next();
  return res.status(401).json({ message: 'A verified IIIT Delhi sign-in is required.' });
};

const authMiddleware = (req, res, next) => {
  const token = bearerToken(req);
  if (!isValidAdminSession(token)) return res.status(401).json({ message: 'Unauthorized' });
  return next();
};

app.post('/api/auth/google', async (req, res) => {
  try {
    const credential = req.body?.credential;
    if (!credential) return res.status(400).json({ message: 'Google credential is required.' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase();
    const isIIITDAccount = payload?.email_verified
      && payload?.hd === 'iiitd.ac.in'
      && email?.endsWith('@iiitd.ac.in');

    if (!isIIITDAccount) {
      return res.status(403).json({ message: 'Please use a verified IIIT Delhi Google account.' });
    }

    const isAdmin = email === ADMIN_EMAIL;
    return res.json({
      token: isAdmin ? createAdminSession() : createViewerSession(),
      is_admin: isAdmin,
      expires_in: isAdmin ? null : VIEWER_SESSION_TTL_MS / 1000,
    });
  } catch {
    return res.status(401).json({ message: 'Google sign-in could not be verified.' });
  }
});

app.post('/api/auth/viewer', requireDbReady, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const credentials = await getViewerCredentials();
    const usernameValid = safeEqual(username, credentials.username.trim().toLowerCase());
    const passwordValid = credentials.passwordHash
      ? await verifyPassword(password, credentials.passwordHash)
      : false;

    if (!usernameValid || !passwordValid) {
      return res.status(401).json({ message: 'Incorrect viewer username or password.' });
    }

    return res.json({ token: createViewerSession(), expires_in: VIEWER_SESSION_TTL_MS / 1000 });
  } catch {
    return res.status(500).json({ message: 'Viewer sign-in could not be completed.' });
  }
});

app.get('/api/auth/session', requireViewerAuth, (req, res) => {
  res.json({
    valid: true,
    is_admin: isValidAdminSession(bearerToken(req)),
  });
});

app.get('/api/admin/session', authMiddleware, (_req, res) => {
  res.json({ valid: true });
});

app.get('/api/admin/viewer-access', authMiddleware, requireDbReady, async (_req, res) => {
  try {
    const credentials = await getViewerCredentials();
    return res.json({ username: credentials.username });
  } catch {
    return res.status(500).json({ message: 'Viewer access settings could not be loaded.' });
  }
});

app.put('/api/admin/viewer-access', authMiddleware, requireDbReady, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!username || password.length < 12) {
    return res.status(400).json({ message: 'Enter a username and a password of at least 12 characters.' });
  }

  try {
    await setAppSettings({
      viewer_username: username,
      viewer_password_hash: await hashPassword(password),
    });
    return res.json({ username });
  } catch {
    return res.status(500).json({ message: 'Viewer access settings could not be updated.' });
  }
});

app.get('/api/batches', (_req, res) => {
  res.json(BATCHES);
});

app.get('/api/ping', (_req, res) => {
  res.status(isDbReady ? 200 : 503).json({ status: isDbReady ? 'ready' : 'warming' });
});

app.use('/api/companies', requireViewerAuth);
app.use('/api/students', requireViewerAuth);
app.use('/api/stats', requireViewerAuth);
app.use('/api/health', requireViewerAuth);

app.use('/api/companies', requireDbReady);
app.use('/api/students', requireDbReady);
app.use('/api/stats', requireDbReady);
app.use('/api/health', requireDbReady);

// Company routes
app.get('/api/companies', async (req, res) => {
  try {
    const data = req.query.cycle
      ? await listCompaniesByCycle(Number(req.query.cycle))
      : await listCompanies(resolveBatchKey(req.query.batch));
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/companies/:id', async (req, res) => {
  try {
    const company = await getCompany(req.params.id);
    if (!company) return res.status(404).json({ message: 'Company not found' });
    return res.json(company);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/companies', authMiddleware, async (req, res) => {
  try {
    const created = await createCompany(withResolvedBatch(req));
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/companies/:id', authMiddleware, async (req, res) => {
  try {
    const exists = await getCompany(req.params.id);
    if (!exists) return res.status(404).json({ message: 'Company not found' });
    const updated = await updateCompany(req.params.id, withResolvedBatch(req));
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/companies/:id', authMiddleware, async (req, res) => {
  await deleteCompany(req.params.id);
  res.status(204).end();
});

// Student routes
app.get('/api/students', async (req, res) => {
  try {
    const data = req.query.cycle
      ? await listStudentsByCycle(Number(req.query.cycle))
      : await listStudents(resolveBatchKey(req.query.batch));
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const student = await getStudent(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    return res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/students', authMiddleware, async (req, res) => {
  try {
    const payload = withResolvedBatch(req);
    if (payload.placement_status === 'Placed') {
      const offers = payload.offers || (payload.company_id ? [{ company_id: payload.company_id }] : []);
      if (!offers.length) return res.status(400).json({ message: 'At least one company offer is required for placed students' });
      for (const offer of offers) {
        const existsCompany = await getCompany(offer.company_id);
        if (!existsCompany) return res.status(400).json({ message: `Company does not exist (id: ${offer.company_id})` });
        if (existsCompany.batch_key && existsCompany.batch_key !== payload.batch_key) {
          return res.status(400).json({ message: `Company ${offer.company_id} belongs to a different batch` });
        }
      }
    }
    const created = await createStudent(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/students/:id', authMiddleware, async (req, res) => {
  try {
    const exists = await getStudent(req.params.id);
    if (!exists) return res.status(404).json({ message: 'Student not found' });
    const payload = withResolvedBatch(req);
    if (payload.placement_status === 'Placed') {
      const offers = payload.offers || (payload.company_id ? [{ company_id: payload.company_id }] : []);
      if (!offers.length) return res.status(400).json({ message: 'At least one company offer is required for placed students' });
      for (const offer of offers) {
        const existsCompany = await getCompany(offer.company_id);
        if (!existsCompany) return res.status(400).json({ message: `Company does not exist (id: ${offer.company_id})` });
        if (existsCompany.batch_key && existsCompany.batch_key !== payload.batch_key) {
          return res.status(400).json({ message: `Company ${offer.company_id} belongs to a different batch` });
        }
      }
    }
    const updated = await updateStudent(req.params.id, payload);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/students/:id', authMiddleware, async (req, res) => {
  await deleteStudent(req.params.id);
  res.status(204).end();
});

// Add a single offer to a student from a company's page. Offer type defaults to the
// company's type but may be overridden per student; compensation/date defaults fall back
// to the company's values when not provided.
app.post('/api/offers', authMiddleware, async (req, res) => {
  try {
    const studentId = req.body?.student_id;
    const companyId = req.body?.company_id;
    if (!studentId || !companyId) return res.status(400).json({ message: 'student_id and company_id are required' });
    const company = await getCompany(companyId);
    if (!company) return res.status(400).json({ message: 'Company not found' });
    const student = await getStudent(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    const updated = await addOfferToStudent(studentId, {
      company_id: companyId,
      offer_type: req.body.offer_type || company.type || null,
      ctc: req.body.ctc ?? company.ctc ?? null,
      stipend: req.body.stipend ?? company.stipend ?? null,
      registration_deadline: req.body.registration_deadline || company.registration_deadline || null,
      offer_date: req.body.offer_date || company.offer_date || null,
    });
    res.status(201).json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = req.query.cycle
      ? await buildStats(null, Number(req.query.cycle))
      : await buildStats(resolveBatchKey(req.query.batch));
    res.json(stats);
  } catch (err) {
    console.error('Error fetching stats:', err.message);
    res.status(500).json({ message: 'Failed to fetch stats (DB timeout)' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    const counts = await getTableCounts();
    res.json({ status: 'ok', db: { host: process.env.PGHOST, database: process.env.PGDATABASE }, counts });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'API route not found.' });
});

app.use('/Placement_Tracker', (req, res) => {
  const suffix = req.originalUrl.replace(/^\/Placement_Tracker\/?/, '/');
  res.redirect(308, `https://${PLACEMENT_ATLAS_HOST}${suffix}`);
});

app.use((req, res, next) => {
  if (req.hostname !== PLACEMENT_ATLAS_HOST) return next();

  return express.static(frontendDistPath)(req, res, (err) => {
    if (err) return next(err);
    return res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
});

app.use(express.static(portfolioDistPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(portfolioDistPath, 'index.html'));
});

const start = async () => {
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });

  let dbReady = false;
  while (!dbReady) {
    try {
      await initDb();
      await ensureDefaultViewerCredentials();
      dbReady = true;
      isDbReady = true;
      console.log('Database initialized successfully');
    } catch (err) {
      console.error('Failed to connect to DB, retrying in 10s...', err.message);
      await new Promise(res => setTimeout(res, 10000));
    }
  }

  // Backfill offers for legacy rows seeded before offers table existed
  try {
    await ensureOfferBackfill();
  } catch (err) {
    console.error('Offer backfill skipped:', err.message);
  }
};

start();
