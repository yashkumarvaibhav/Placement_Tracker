import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

export const INSTITUTE_DOMAIN = 'iiitd.ac.in';
export const ADMIN_EMAIL = 'yash25091@iiitd.ac.in';
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '183667160330-4jtc41mg2jf7ugk6211smgcrr7lcfo02.apps.googleusercontent.com';
export const PRODUCT_NAME = 'Kaju Katli';
export const INSTITUTE_NAME = 'Very Good Institute of Information Technology';

// The hostname the app is served from.
export const APP_HOST = process.env.APP_HOST || 'kajukatli.yashkumarvaibhav.me';
// The retired hostname. It stays routed to this process so old links reach the takedown notice
// instead of failing to resolve, and it never serves the app again — see takedown.js.
export const RETIRED_HOST = process.env.RETIRED_HOST || process.env.PLACEMENT_ATLAS_HOST || 'placement-atlas.yashkumarvaibhav.me';
export const PORTFOLIO_URL = process.env.PORTFOLIO_URL || 'https://yashkumarvaibhav.me';
// Emergency switch that takes the live host down too. The retired host is suspended either way.
export const SITE_TAKEDOWN = String(process.env.SITE_TAKEDOWN || 'off').toLowerCase() !== 'off';
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
