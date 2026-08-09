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
import {
  ACCESS_WHITELIST,
  grantFor,
  isInstituteEmail,
  normalizeEmail,
} from '../access.js';
import { getRatingViewerContext, recordAccessRequest } from '../db.js';
import { requireDbReady } from '../ready.js';
import {
  ADMIN_SESSION_TTL_MS,
  GOOGLE_CLIENT_ID,
  INSTITUTE_DOMAIN,
  INSTITUTE_NAME,
  VIEWER_SESSION_TTL_MS,
} from '../config.js';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const router = Router();

const PENDING_MESSAGE = 'Your access request has been sent to the admin. You will be able to sign in once it is approved.';
const DENIED_MESSAGE = 'Your access request was declined. Contact the admin if you believe this is a mistake.';

router.post('/google', authRateLimiter, requireDbReady, async (req, res, next) => {
  let payload;
  try {
    const credential = req.body?.credential;
    if (!credential) return res.status(400).json({ message: 'Google credential is required.' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ message: 'Google sign-in could not be verified.' });
  }

  try {
    const email = normalizeEmail(payload?.email);
    // A whitelisted partner account can sit outside the institute domain, so the hosted-domain
    // rule is enforced for everyone else only.
    const verified = Boolean(payload?.email_verified) && Boolean(email);
    const onInstituteDomain = payload?.hd === INSTITUTE_DOMAIN && isInstituteEmail(email);
    if (!verified || (!onInstituteDomain && !ACCESS_WHITELIST.has(email))) {
      return res.status(403).json({
        code: 'DOMAIN_NOT_ALLOWED',
        message: `Please use a verified ${INSTITUTE_NAME} Google account.`,
      });
    }

    const grant = await grantFor(email);
    if (grant) {
      const isAdmin = grant === 'admin';
      return res.json({
        token: isAdmin ? createAdminSession(email) : createViewerSession(email),
        is_admin: isAdmin,
        expires_in: (isAdmin ? ADMIN_SESSION_TTL_MS : VIEWER_SESSION_TTL_MS) / 1000,
      });
    }

    // On the institute domain but not on the placement roster: queue the request for an admin
    // instead of turning them away for good.
    const request = await recordAccessRequest({ email, name: payload?.name });
    return res.status(403).json({
      code: request.status === 'denied' ? 'ACCESS_DENIED' : 'ACCESS_PENDING',
      message: request.status === 'denied' ? DENIED_MESSAGE : PENDING_MESSAGE,
    });
  } catch (err) {
    return next(err);
  }
});

// The shared viewer username/password sign-in was removed: Google is the only way in.
router.post('/viewer', authRateLimiter, (_req, res) => res.status(410).json({
  message: `Viewer username and password sign-in has been removed. Please continue with your ${INSTITUTE_NAME} Google account.`,
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
