import express from 'express';
import cors from 'cors';
import path from 'path';
import { PLACEMENT_ATLAS_HOST, frontendDistPath, portfolioDistPath } from './config.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import companiesRoutes from './routes/companies.js';
import studentsRoutes from './routes/students.js';
import offersRoutes from './routes/offers.js';
import miscRoutes from './routes/misc.js';

const app = express();

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

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api', miscRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'API route not found.' });
});

// Last-resort API error handler: maps common Postgres constraint violations to client errors
// and keeps everything else a logged 500 instead of an unhandled rejection.
// eslint-disable-next-line no-unused-vars
app.use('/api', (err, _req, res, _next) => {
  console.error('[API] Unhandled route error:', err);
  if (err?.code === '23503') {
    return res.status(409).json({ message: 'This record is still referenced by other records and cannot be changed this way.' });
  }
  if (err?.code === '23505') {
    return res.status(409).json({ message: 'A record with these details already exists.' });
  }
  return res.status(500).json({ message: 'Unexpected server error.' });
});

app.use('/Placement_Tracker', (req, res) => {
  const suffix = req.originalUrl.replace(/^\/Placement_Tracker\/?/, '/');
  res.redirect(308, `https://${PLACEMENT_ATLAS_HOST}${suffix}`);
});

// The placement-atlas hostname serves the tracker SPA; any other hostname falls through to
// the portfolio site below.
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

export default app;
