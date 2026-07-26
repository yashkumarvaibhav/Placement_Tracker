import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import {
  authRateLimiter,
  bearerToken,
  createAdminSession,
  createViewerSession,
  getViewerCredentials,
  getRatingEmail,
  isValidAdminSession,
  ratingAccountId,
  requireViewerAuth,
  safeEqual,
  verifyPassword,
} from '../auth.js';
import { getRatingViewerContext } from '../db.js';
import { requireDbReady } from '../ready.js';
import { ADMIN_EMAIL, ADMIN_SESSION_TTL_MS, GOOGLE_CLIENT_ID, VIEWER_SESSION_TTL_MS } from '../config.js';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const router = Router();

router.post('/google', authRateLimiter, async (req, res) => {
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
      token: isAdmin ? createAdminSession(email) : createViewerSession(email),
      is_admin: isAdmin,
      expires_in: (isAdmin ? ADMIN_SESSION_TTL_MS : VIEWER_SESSION_TTL_MS) / 1000,
    });
  } catch {
    return res.status(401).json({ message: 'Google sign-in could not be verified.' });
  }
});

router.post('/viewer', authRateLimiter, requireDbReady, async (req, res) => {
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

router.get('/session', requireViewerAuth, async (req, res, next) => {
  try {
    const email = getRatingEmail(req);
    const selfStudent = email ? await getRatingViewerContext(email) : null;
    return res.json({
      valid: true,
      is_admin: isValidAdminSession(bearerToken(req)),
      can_rate: Boolean(email),
      ratings_account_id: ratingAccountId(req),
      self_student: selfStudent,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
