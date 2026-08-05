import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import {
  authRateLimiter,
  bearerToken,
  createAdminSession,
  createViewerSession,
  getRatingEmail,
  isValidAdminSession,
  ratingAccountId,
  requireViewerAuth,
} from '../auth.js';
import { getRatingViewerContext } from '../db.js';
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

// The shared viewer username/password sign-in was removed: Google is the only way in.
router.post('/viewer', authRateLimiter, (_req, res) => res.status(410).json({
  message: 'Viewer username and password sign-in has been removed. Please continue with your IIIT Delhi Google account.',
}));

router.get('/session', requireViewerAuth, async (req, res, next) => {
  try {
    const email = getRatingEmail(req);
    const ratingIdentity = email ? await getRatingViewerContext(email) : null;
    const selfStudent = ratingIdentity
      ? { ...ratingIdentity, id: ratingIdentity.id ?? ratingIdentity.student_id }
      : null;
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
