import { Router } from 'express';
import { authMiddleware, getRatingEmail } from '../auth.js';
import { invalidateGrant } from '../access.js';
import { requireDbReady } from '../ready.js';
import { APP_HOST } from '../config.js';
import {
  diffPlacementCalendarSnapshots,
  getLatestPlacementCalendarSnapshot,
  getPlacementCalendarCellHistory,
  getPlacementCalendarSnapshot,
  getPreviousPlacementCalendarSnapshotId,
  getTableCounts,
  listAccessRequests,
  listPlacementCalendarSnapshots,
  setAccessRequestStatus,
} from '../db.js';
import {
  createCalendarOAuthUrl,
  disconnectCalendarOAuth,
  getCalendarOAuthStatus,
  handleCalendarOAuthCallback,
  syncPlacementCalendar,
} from '../calendar-sync.js';

const router = Router();

router.get('/session', authMiddleware, (_req, res) => {
  res.json({ valid: true });
});

router.get('/health', authMiddleware, async (_req, res) => {
  try {
    const counts = await getTableCounts();
    res.json({ status: 'ok', db: { host: process.env.PGHOST, database: process.env.PGDATABASE }, counts });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/access-requests', authMiddleware, requireDbReady, async (_req, res, next) => {
  try {
    return res.json(await listAccessRequests());
  } catch (err) {
    return next(err);
  }
});

// Approve or deny a queued institute account. Both decisions drop the cached grant so the next
// request from that person is judged on the new status instead of waiting out their session.
router.put('/access-requests/:id', authMiddleware, requireDbReady, async (req, res, next) => {
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!['approved', 'denied', 'pending'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved, denied, or pending.' });
  }

  try {
    const updated = await setAccessRequestStatus(req.params.id, status, getRatingEmail(req));
    if (!updated) return res.status(404).json({ message: 'Access request not found.' });

    invalidateGrant(updated.email);
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

// The OAuth callback is hit by a browser redirect from Google, so it carries no bearer token.
router.get('/calendar/oauth/callback', requireDbReady, async (req, res) => {
  try {
    const redirectUrl = await handleCalendarOAuthCallback({
      code: req.query.code,
      state: req.query.state,
    });
    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('Placement Calendar OAuth callback failed:', err.message);
    const fallback = `https://${APP_HOST}/#/admin/calendar?calendarOAuth=failed&reason=callback-error`;
    return res.redirect(302, fallback);
  }
});

router.get('/calendar/oauth/status', authMiddleware, requireDbReady, async (_req, res) => {
  try {
    return res.json(await getCalendarOAuthStatus());
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/calendar/oauth/start', authMiddleware, requireDbReady, async (_req, res) => {
  try {
    return res.json({ authorization_url: await createCalendarOAuthUrl() });
  } catch (err) {
    const status = err.code === 'OAUTH_NOT_CONFIGURED' ? 400 : 500;
    return res.status(status).json({ message: err.message });
  }
});

router.delete('/calendar/oauth', authMiddleware, requireDbReady, async (_req, res) => {
  try {
    await disconnectCalendarOAuth();
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/calendar/snapshots', authMiddleware, requireDbReady, async (req, res) => {
  try {
    return res.json(await listPlacementCalendarSnapshots(req.query.limit));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/calendar/latest', authMiddleware, requireDbReady, async (_req, res) => {
  try {
    const latest = await getLatestPlacementCalendarSnapshot();
    if (!latest) return res.status(404).json({ message: 'No Placement Calendar snapshots have been captured yet.' });
    return res.json(await getPlacementCalendarSnapshot(latest.id));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/calendar/snapshots/:id/diff', authMiddleware, requireDbReady, async (req, res) => {
  try {
    const against = req.query.against === 'previous'
      ? await getPreviousPlacementCalendarSnapshotId(req.params.id)
      : req.query.against;
    if (!against) return res.json({ diff: null });

    const diff = await diffPlacementCalendarSnapshots(against, req.params.id);
    if (!diff) return res.status(404).json({ message: 'One or both snapshots were not found.' });
    return res.json({ diff });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/calendar/snapshots/:id/cell-history', authMiddleware, requireDbReady, async (req, res) => {
  try {
    const history = await getPlacementCalendarCellHistory(req.params.id);
    if (!history) return res.status(404).json({ message: 'Placement Calendar snapshot not found.' });
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/calendar/snapshots/:id', authMiddleware, requireDbReady, async (req, res) => {
  try {
    const snapshot = await getPlacementCalendarSnapshot(req.params.id);
    if (!snapshot) return res.status(404).json({ message: 'Placement Calendar snapshot not found.' });
    return res.json(snapshot);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/calendar/sync', authMiddleware, requireDbReady, async (_req, res) => {
  try {
    const result = await syncPlacementCalendar();
    return res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    const status = err.code === 'CALENDAR_OAUTH_REQUIRED' ? 409 : 500;
    return res.status(status).json({ message: err.message, code: err.code });
  }
});

export default router;
