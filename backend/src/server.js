import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { BATCHES, getBatchConfig } from './batches.js';
import {
  adminToken,
  buildStats,
  createCompany,
  createStudent,
  deleteCompany,
  deleteStudent,
  ensureOfferBackfill,
  getTableCounts,
  getCompany,
  getStudent,
  initDb,
  listCompanies,
  listStudents,
  updateCompany,
  updateStudent,
} from './db.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'yash25091@iiitd.ac.in';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '***REMOVED***';
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors({
  origin: '*', // Allow all origins for simplicity (or specify your GitHub Pages URL)
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

const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  const token = auth.replace('Bearer ', '').trim();
  if (token !== adminToken) return res.status(401).json({ message: 'Unauthorized' });
  return next();
};

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({ token: adminToken, email });
  }
  return res.status(401).json({ message: 'Invalid credentials' });
});

app.get('/api/batches', (_req, res) => {
  res.json(BATCHES);
});

app.get('/api/ping', (_req, res) => {
  res.status(isDbReady ? 200 : 503).json({ status: isDbReady ? 'ready' : 'warming' });
});

app.use('/api/companies', requireDbReady);
app.use('/api/students', requireDbReady);
app.use('/api/stats', requireDbReady);
app.use('/api/health', requireDbReady);

// Company routes
app.get('/api/companies', async (req, res) => {
  try {
    const data = await listCompanies(resolveBatchKey(req.query.batch));
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
    const data = await listStudents(resolveBatchKey(req.query.batch));
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

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await buildStats(resolveBatchKey(req.query.batch));
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

app.get('/', (_req, res) => {
  res.json({ status: 'Placement Tracker API', version: '1.0.0' });
});

const start = async () => {
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });

  let dbReady = false;
  while (!dbReady) {
    try {
      await initDb();
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
