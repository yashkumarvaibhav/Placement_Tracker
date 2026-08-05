import express from 'express';
import cors from 'cors';
import path from 'path';
import { PLACEMENT_ATLAS_HOST, SITE_TAKEDOWN, frontendDistPath, portfolioDistPath } from './config.js';
import takedownGate from './takedown.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import companiesRoutes from './routes/companies.js';
import studentsRoutes from './routes/students.js';
import offersRoutes from './routes/offers.js';
import ratingsRoutes from './routes/ratings.js';
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
// Liveness probe for the systemd healthcheck timer. It answers only on the loopback hostname,
// so it stays invisible on the public hostnames, and it sits ahead of the takedown gate so a
// deliberately suspended site is not mistaken for a dead process and restart-looped.
app.get('/healthz', (req, res, next) => {
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(req.hostname)) return next();
  res.set('Cache-Control', 'no-store');
  return res.json({ status: 'ok', takedown: SITE_TAKEDOWN });
});

// Ahead of the routes but behind CORS, so a browser tab still holding the old bundle reads the
// takedown message instead of a cross-origin error.
app.use(takedownGate);

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/ratings', ratingsRoutes);
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
