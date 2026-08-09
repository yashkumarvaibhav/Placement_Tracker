import crypto from 'crypto';
import { hasActiveGrant } from './access.js';
import {
  ADMIN_EMAIL,
  ADMIN_SESSION_TTL_MS,
  INSTITUTE_NAME,
  PRODUCT_NAME,
  SESSION_SECRET,
  VIEWER_SESSION_TTL_MS,
} from './config.js';

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

export const createViewerSession = (email) => createSignedSession({
  type: 'viewer',
  auth_source: 'google',
  email: String(email || '').trim().toLowerCase(),
  expires_at: Date.now() + VIEWER_SESSION_TTL_MS,
});

export const createAdminSession = (email = ADMIN_EMAIL) => createSignedSession({
  type: 'admin',
  auth_source: 'google',
  subject: 'primary-admin',
  email: String(email || ADMIN_EMAIL).trim().toLowerCase(),
  expires_at: Date.now() + ADMIN_SESSION_TTL_MS,
});

// Viewer access is Google-only: sessions minted by the retired shared username/password login
// carry auth_source 'shared' and are rejected here, so any that are still in flight stop working.
export const isValidViewerSession = (token) => {
  const session = readSignedSession(token);
  return session?.type === 'viewer'
    && session.auth_source === 'google'
    && Number(session.expires_at) > Date.now();
};

export const isValidAdminSession = (token) => {
  const session = readSignedSession(token);
  return session?.type === 'admin'
    && session.auth_source === 'google'
    && session.subject === 'primary-admin'
    && Number(session.expires_at) > Date.now();
};

// Minimal in-memory limiter for the auth endpoints: Google token verification is comparatively
// expensive, so unthrottled retries are a CPU and upstream-quota drain. Per-process state is
// fine for this single-instance deployment.
const AUTH_RATE_WINDOW_MS = 5 * 60 * 1000;
const AUTH_RATE_MAX_ATTEMPTS = 20;
const authAttempts = new Map();
export const authRateLimiter = (req, res, next) => {
  const key = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  const now = Date.now();
  if (authAttempts.size > 10000) {
    for (const [k, v] of authAttempts) { if (now > v.resetAt) authAttempts.delete(k); }
  }
  const entry = authAttempts.get(key) || { count: 0, resetAt: now + AUTH_RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + AUTH_RATE_WINDOW_MS; }
  entry.count += 1;
  authAttempts.set(key, entry);
  if (entry.count > AUTH_RATE_MAX_ATTEMPTS) {
    return res.status(429).json({ message: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
  }
  return next();
};

export const bearerToken = (req) => {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
};

export const getAuthenticatedSession = (req) => {
  const session = readSignedSession(bearerToken(req));
  if (!session || Number(session.expires_at) <= Date.now()) return null;
  if (session.type === 'admin'
    && session.auth_source === 'google'
    && session.subject === 'primary-admin') {
    return session;
  }
  if (session.type === 'viewer' && session.auth_source === 'google') return session;
  return null;
};

export const getRatingEmail = (req) => {
  const session = getAuthenticatedSession(req);
  if (!session) return '';
  if (session.type === 'admin') {
    // Admin sessions created before the ratings launch did not include the email, but their
    // signed primary-admin subject is already bound to the configured admin account.
    return String(session.email || ADMIN_EMAIL).trim().toLowerCase();
  }
  if (session.auth_source !== 'google') return '';
  return String(session.email || '').trim().toLowerCase();
};

export const ratingAccountId = (req) => {
  const email = getRatingEmail(req);
  const identity = email || 'unidentified';
  return crypto.createHmac('sha256', SESSION_SECRET).update(`ratings:${identity}`).digest('base64url').slice(0, 18);
};

// Viewer access is revocable, so every request re-checks that the signed-in address still has a
// grant instead of trusting the token for its full lifetime. `hasActiveGrant` caches, and an
// admin decision clears that cache, so an approval or a denial takes effect right away.
export const requireViewerAuth = async (req, res, next) => {
  const token = bearerToken(req);
  if (isValidAdminSession(token)) return next();
  if (!isValidViewerSession(token)) {
    return res.status(401).json({ message: `A verified ${INSTITUTE_NAME} sign-in is required.` });
  }

  try {
    const session = readSignedSession(token);
    if (await hasActiveGrant(session?.email)) return next();
    return res.status(403).json({
      code: 'ACCESS_REVOKED',
      message: `Your access to ${PRODUCT_NAME} is no longer approved. Please contact the admin.`,
    });
  } catch (err) {
    return next(err);
  }
};

export const requireRatingAuth = (req, res, next) => {
  const email = getRatingEmail(req);
  if (!email) {
    return res.status(403).json({
      message: `Skill ratings require an individual ${INSTITUTE_NAME} Google sign-in so admins can audit attribution.`,
    });
  }
  req.ratingEmail = email;
  return next();
};

export const authMiddleware = (req, res, next) => {
  const token = bearerToken(req);
  if (!isValidAdminSession(token)) return res.status(401).json({ message: 'Unauthorized' });
  return next();
};
