import { ADMIN_EMAIL, INSTITUTE_DOMAIN } from './config.js';
import { getAccessRequest } from './db.js';

// Addresses that always get in, checked before the domain rule so a non-institute address on
// this list would still work. Nothing else outside the institute domain is ever accepted.
// The Placement Cell and partner addresses that used to sit here were removed when the site
// moved hosts; the admin in ADMIN_EMAIL is granted separately and is not listed here.
export const ACCESS_WHITELIST = new Set([
  'vaibhav25006@iiitd.ac.in',
]);

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const isInstituteEmail = (email) => normalizeEmail(email).endsWith(`@${INSTITUTE_DOMAIN}`);

// Why this address may see data, or null if it may not. Order matters: admin, then the standing
// whitelist, then an admin-approved request.
//
// Sitting on the placement roster used to be a grant of its own, which auto-approved the whole
// current cycle on first sign-in. That is gone: since the move, being a student is no longer a
// reason to get in on sight, so roster addresses queue for approval like everyone else.
export const grantFor = async (email) => {
  const address = normalizeEmail(email);
  if (!address) return null;
  if (address === ADMIN_EMAIL) return 'admin';
  if (ACCESS_WHITELIST.has(address)) return 'whitelist';
  if (!isInstituteEmail(address)) return null;

  const request = await getAccessRequest(address);
  return request?.status === 'approved' ? 'approved' : null;
};

// Sessions live for 12 hours, so a per-request grant check is what makes a denial take effect
// before then. The check is cached briefly to keep hot data routes off the database, and admin
// decisions clear the entry so approve/deny apply immediately.
const GRANT_CACHE_TTL_MS = 60 * 1000;
const grantCache = new Map();

export const invalidateGrant = (email) => {
  const address = normalizeEmail(email);
  if (address) grantCache.delete(address);
  else grantCache.clear();
};

export const hasActiveGrant = async (email) => {
  const address = normalizeEmail(email);
  if (!address) return false;

  const cached = grantCache.get(address);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  const allowed = Boolean(await grantFor(address));
  if (grantCache.size > 5000) grantCache.clear();
  grantCache.set(address, { allowed, expiresAt: Date.now() + GRANT_CACHE_TTL_MS });
  return allowed;
};
