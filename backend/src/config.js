import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

export const ADMIN_EMAIL = 'yash25091@iiitd.ac.in';
export const DEFAULT_VIEWER_USERNAME = process.env.VIEWER_USERNAME || 'guest@placement-atlas';
export const DEFAULT_VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || '';
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '183667160330-4jtc41mg2jf7ugk6211smgcrr7lcfo02.apps.googleusercontent.com';
export const PLACEMENT_ATLAS_HOST = process.env.PLACEMENT_ATLAS_HOST || 'placement-atlas.yashkumarvaibhav.me';
export const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
export const VIEWER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PORT = process.env.PORT || 4000;

const here = path.dirname(fileURLToPath(import.meta.url));
export const frontendDistPath = path.resolve(here, '../../frontend/dist');
export const portfolioDistPath = path.resolve(here, '../../../portfolio-site/dist');

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set; viewer sessions will reset when the server restarts.');
}
