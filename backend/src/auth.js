import crypto from 'crypto';
import argon2 from 'argon2';
import { getAppSettings, setAppSettings } from './db.js';
import {
  ADMIN_SESSION_TTL_MS,
  DEFAULT_VIEWER_PASSWORD,
  DEFAULT_VIEWER_USERNAME,
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

export const createViewerSession = () => createSignedSession({
  type: 'viewer',
  expires_at: Date.now() + VIEWER_SESSION_TTL_MS,
});

export const createAdminSession = () => createSignedSession({
  type: 'admin',
  auth_source: 'google',
  subject: 'primary-admin',
  expires_at: Date.now() + ADMIN_SESSION_TTL_MS,
});

export const isValidViewerSession = (token) => {
  const session = readSignedSession(token);
  return session?.type === 'viewer' && Number(session.expires_at) > Date.now();
};

export const isValidAdminSession = (token) => {
  const session = readSignedSession(token);
  return session?.type === 'admin'
    && session.auth_source === 'google'
    && session.subject === 'primary-admin'
    && Number(session.expires_at) > Date.now();
};

// Minimal in-memory limiter for the auth endpoints: argon2 verification is deliberately
// expensive, so unthrottled guessing is both a brute-force and a CPU-DoS vector. Per-process
// state is fine for this single-instance deployment.
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

export const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const hashPassword = (password) => argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
});

const verifyLegacyScryptPassword = (password, storedHash) => {
  const [algorithm, salt, expectedHash] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHash) return false;

  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'base64url');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

export const verifyPassword = async (password, storedHash) => {
  if (String(storedHash).startsWith('$argon2id$')) {
    return argon2.verify(storedHash, password);
  }
  return verifyLegacyScryptPassword(password, storedHash);
};

export const getViewerCredentials = async () => {
  const settings = await getAppSettings(['viewer_username', 'viewer_password_hash']);
  return {
    username: settings.viewer_username || DEFAULT_VIEWER_USERNAME,
    passwordHash: settings.viewer_password_hash || '',
  };
};

export const ensureDefaultViewerCredentials = async () => {
  const settings = await getAppSettings(['viewer_username', 'viewer_password_hash']);
  const defaults = {};

  if (!settings.viewer_username) defaults.viewer_username = DEFAULT_VIEWER_USERNAME;
  if (!settings.viewer_password_hash && DEFAULT_VIEWER_PASSWORD) {
    defaults.viewer_password_hash = await hashPassword(DEFAULT_VIEWER_PASSWORD);
  }

  await setAppSettings(defaults);
};

export const bearerToken = (req) => {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
};

export const requireViewerAuth = (req, res, next) => {
  const token = bearerToken(req);
  if (isValidAdminSession(token) || isValidViewerSession(token)) return next();
  return res.status(401).json({ message: 'A verified IIIT Delhi sign-in is required.' });
};

export const authMiddleware = (req, res, next) => {
  const token = bearerToken(req);
  if (!isValidAdminSession(token)) return res.status(401).json({ message: 'Unauthorized' });
  return next();
};
