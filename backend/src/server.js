import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
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
app.use(cors());
app.use(express.json());

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

// Company routes
app.get('/api/companies', async (_req, res) => {
  const data = await listCompanies();
  res.json(data);
});

app.get('/api/companies/:id', async (req, res) => {
  const company = await getCompany(req.params.id);
  if (!company) return res.status(404).json({ message: 'Company not found' });
  return res.json(company);
});

app.post('/api/companies', authMiddleware, async (req, res) => {
  try {
    const created = await createCompany(req.body);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/companies/:id', authMiddleware, async (req, res) => {
  try {
    const exists = await getCompany(req.params.id);
    if (!exists) return res.status(404).json({ message: 'Company not found' });
    const updated = await updateCompany(req.params.id, req.body);
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
app.get('/api/students', async (_req, res) => {
  const data = await listStudents();
  res.json(data);
});

app.get('/api/students/:id', async (req, res) => {
  const student = await getStudent(req.params.id);
  if (!student) return res.status(404).json({ message: 'Student not found' });
  return res.json(student);
});

app.post('/api/students', authMiddleware, async (req, res) => {
  try {
    if (req.body.placement_status === 'Placed') {
      const offers = req.body.offers || (req.body.company_id ? [{ company_id: req.body.company_id }] : []);
      if (!offers.length) return res.status(400).json({ message: 'At least one company offer is required for placed students' });
      for (const offer of offers) {
        const existsCompany = await getCompany(offer.company_id);
        if (!existsCompany) return res.status(400).json({ message: `Company does not exist (id: ${offer.company_id})` });
      }
    }
    const created = await createStudent(req.body);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/students/:id', authMiddleware, async (req, res) => {
  try {
    const exists = await getStudent(req.params.id);
    if (!exists) return res.status(404).json({ message: 'Student not found' });
    if (req.body.placement_status === 'Placed') {
      const offers = req.body.offers || (req.body.company_id ? [{ company_id: req.body.company_id }] : []);
      if (!offers.length) return res.status(400).json({ message: 'At least one company offer is required for placed students' });
      for (const offer of offers) {
        const existsCompany = await getCompany(offer.company_id);
        if (!existsCompany) return res.status(400).json({ message: `Company does not exist (id: ${offer.company_id})` });
      }
    }
    const updated = await updateStudent(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/students/:id', authMiddleware, async (req, res) => {
  await deleteStudent(req.params.id);
  res.status(204).end();
});

app.get('/api/stats', async (_req, res) => {
  const stats = await buildStats();
  res.json(stats);
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
  await initDb();
  // Backfill offers for legacy rows seeded before offers table existed
  try {
    await ensureOfferBackfill();
  } catch (err) {
    console.error('Offer backfill skipped:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
};

start();
