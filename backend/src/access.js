import { ADMIN_EMAIL, INSTITUTE_DOMAIN } from './config.js';
import { findPlacementRosterStudent, getAccessRequest } from './db.js';

// Placement Cell and partner addresses that always get in, checked before the domain rule so a
// non-institute address on this list still works. Nothing else outside the institute domain is
// ever accepted.
export const ACCESS_WHITELIST = new Set([
  'support-placement@iiitd.ac.in',
  'admin-placement@iiitd.ac.in',
  'admin-placement1@iiitd.ac.in',
  'placement@iiitd.ac.in',
  'placement-consultant@iiitd.ac.in',
  'hcs-placement@iiitd.ac.in',
  'scp@iiitd.ac.in',
  'rashmil@iiitd.ac.in',
  'dharnish@knowledgechakra.com',
]);

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const isInstituteEmail = (email) => normalizeEmail(email).endsWith(`@${INSTITUTE_DOMAIN}`);

// Why this address may see data, or null if it may not. Order matters: admin, then the standing
// whitelist, then the current placement roster, then an admin-approved request.
export const grantFor = async (email) => {
  const address = normalizeEmail(email);
  if (!address) return null;
  if (address === ADMIN_EMAIL) return 'admin';
  if (ACCESS_WHITELIST.has(address)) return 'whitelist';
  if (!isInstituteEmail(address)) return null;
  if (await findPlacementRosterStudent(address)) return 'roster';

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
