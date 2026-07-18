import { Router } from 'express';
import { BATCHES } from '../batches.js';
import { requireViewerAuth } from '../auth.js';
import { isDbReady } from '../ready.js';
import { resolveBatchKey } from './helpers.js';
import { buildStats, getTableCounts } from '../db.js';

const router = Router();

router.get('/batches', (_req, res) => {
  res.json(BATCHES);
});

router.get('/ping', (_req, res) => {
  res.status(isDbReady() ? 200 : 503).json({ status: isDbReady() ? 'ready' : 'warming' });
});

router.get('/stats', requireViewerAuth, async (req, res) => {
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

// Public health stays a bare probe; infra details (DB host/database, table counts) are
// admin-only under /api/admin/health so the public endpoint no longer maps the deployment.
router.get('/health', async (_req, res) => {
  try {
    await getTableCounts();
    res.json({ status: 'ok' });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

export default router;
