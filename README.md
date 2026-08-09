# Placement Tracker

React + Vite frontend with an Express backend and PostgreSQL. The frontend, API, and database are hosted on the VM, with Cloudflare Tunnel providing public HTTPS access.

## Prerequisites
- Node.js 18+ and npm
- PostgreSQL connection details: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`

## Setup
1) Backend
```bash
cd backend
cp .env.example .env   # fill with local PostgreSQL credentials
npm install
npm start               # runs on PORT (default 4000)
```

2) Frontend
```bash
cd frontend
npm install
npm run dev             # http://localhost:5173/
```
- Dev proxy is already configured (`/api` → `http://localhost:4000`). If you run the API elsewhere, set `VITE_API_BASE` accordingly.

## Data import (SQLite → PostgreSQL)
- CSVs exported from the legacy SQLite DB live in `exports/backend_companies.csv`, `exports/backend_students.csv`, `exports/backend_offers.csv` (order: companies → students → offers).
- Detailed steps are in `backend/IMPORT_SQLITE.md` (UI import and `psql` commands).
- Historical M.Tech CSE aggregate files for academic years 2022-23 through 2024-25 can be re-imported with `cd backend && npm run import:historical-mtech-cse`. The importer validates each parsed offer total against the source before writing.
- Detailed B.Tech 2025, M.Tech 2025, and B.Tech 2026 placement CSVs can be compared with the database using `cd backend && npm run import:historical-placement-details`. Add `-- --apply` to write changes. For B.Tech 2026, the new CSV wins when the same field or student-company offer conflicts, while offers found in only one source are preserved. Empty CSV fields retain available earlier details. Other historical batches fill blanks without replacing populated values. All differences and actions are recorded in `historical-placement-import-report.json`.
- Export the complete B.Tech 2026 earlier-vs-new comparison as a readable CSV with `cd backend && npm run export:btech-2026-differences`.
- Import B.Tech 2027 summer internships with `cd backend && npm run import:btech-2027-summer -- --apply`. Existing student-company offers are preserved so manually converting a summer internship to a PPO is not undone by reruns.

## VM deployment
- `placement-tracker.service` runs the Node application and restarts it automatically.
- `placement-tracker-postgres` stores PostgreSQL data in the `placement-tracker-postgres-data` Docker volume and uses the `unless-stopped` restart policy.
- `gwiz-tunnel.service` publishes `yashkumarvaibhav.me`, `kajukatli.yashkumarvaibhav.me` and the retired `placement-atlas.yashkumarvaibhav.me` through Cloudflare Tunnel.
- The portfolio is served from `yashkumarvaibhav.me`. Kaju Katli is served from `kajukatli.yashkumarvaibhav.me` (`APP_HOST`).
- `placement-atlas.yashkumarvaibhav.me` (`RETIRED_HOST`) is retired. It stays routed here only so old links reach the takedown notice instead of failing to resolve.
- `yashkumarvaibhav.me/Placement_Tracker/` also answers with the notice. It deliberately no longer redirects anywhere, so the portfolio does not advertise the current hostname.

## Retired hostname and the takedown switch
- `RETIRED_HOST` answers every path — including its API and sign-in — with a `503` takedown notice pointing at the portfolio. This is unconditional; it is not tied to the switch below. See `backend/src/takedown.js`.
- The notice names neither the product nor the current hostname: the retired host is public, and naming the new one there would undo the move.
- `SITE_TAKEDOWN` in `backend/.env` is the emergency switch for taking the **live** host down too. It is off unless set to something other than `off`, and needs a backend restart.
- The portfolio on `yashkumarvaibhav.me`, served by the same process, stays up under either — the notice points people there.
- `placement-tracker-healthcheck.service` probes `/healthz` rather than `/api/ping`, because a suspended API is not a dead process. `/healthz` answers on the loopback hostname only.

## Viewer access
- Google sign-in is verified by the backend against `GOOGLE_CLIENT_ID` and the `iiitd.ac.in` hosted domain. It is the only way to sign in.
- The shared viewer username and password login was removed. `POST /api/auth/viewer` now answers `410`, sessions minted by it are rejected, and the stored credentials are deleted from `app_settings` on startup.
- Who gets in, in order (`backend/src/access.js`):
  1. `ADMIN_EMAIL` signs in as admin.
  2. `ACCESS_WHITELIST` — checked before the domain rule, so an address outside `iiitd.ac.in` could be listed there.
  3. Any other `iiitd.ac.in` address with an `approved` row in `access_requests`.
- Sitting on the placement roster is **no longer** a grant. It used to auto-approve the whole current cycle on first sign-in; since the move to `APP_HOST`, roster addresses queue for approval like everyone else.
- Everything else on the institute domain is queued as `pending` in `access_requests` and sees no data until an admin approves it at `/#/admin/access`. Addresses outside the institute domain are refused outright and are never queued.
- Grants are re-checked on every data request (cached for 60s) so approving or revoking someone takes effect immediately rather than when their 12-hour session expires.
- Google email addresses are used for domain verification and a private roster-to-account
  mapping supports self-rating. A submitted rating keeps its email attribution for audit,
  visible only in the admin-only Ratings analytics screen; viewer-facing APIs expose only
  averages and rating counts.
- Read access to placement data requires a signed viewer session. Configure a stable `SESSION_SECRET` in `backend/.env`.

## Admin login
- `yash25091@iiitd.ac.in` automatically receives admin access after a successful Very Good Institute of Information Technology Google sign-in.
- There is no separate admin password or TOTP login endpoint.

## Placement Calendar
- The admin-only Placement Calendar lives at `/#/admin/calendar`.
- Connect Google Sheets through OAuth from that page. The backend stores the Google refresh token encrypted with `PLACEMENT_CALENDAR_TOKEN_SECRET` or `SESSION_SECRET`; it is never sent to the frontend.
- Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and the authorized redirect URI `https://placement-atlas.yashkumarvaibhav.me/api/admin/calendar/oauth/callback`.
- The source spreadsheet defaults to `1FqgXNGWUUa5uHRYEHEZ7iYz3ZpOpah7TnGIBGLhyoRU`; override with `PLACEMENT_CALENDAR_SPREADSHEET_ID` and `PLACEMENT_CALENDAR_SHEET_ID`.
- The backend polls Google Sheets every 10 minutes by default (`PLACEMENT_CALENDAR_SYNC_INTERVAL_MS=600000`) and the admin page also has a manual Sync now button. Set the interval to `0` to disable automatic polling.
- Each sync stores an immutable snapshot only when the canonical Sheet content or row visibility changes. Snapshots preserve visible and hidden rows, display/effective/user-entered cell values, notes/links where exposed by the Sheets API, row visibility flags, parsed events, and a version diff.
- When a new snapshot is captured, the backend can notify any configured channels without blocking snapshot preservation. Email uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `PLACEMENT_CALENDAR_NOTIFY_EMAIL`. Google Chat uses `PLACEMENT_CALENDAR_GOOGLE_CHAT_WEBHOOK_URL`. WhatsApp uses Meta Cloud API settings: `WHATSAPP_CLOUD_API_VERSION`, `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, and `PLACEMENT_CALENDAR_WHATSAPP_TO`; proactive WhatsApp alerts may require an approved Meta template depending on your WhatsApp setup.
- Polling cannot capture changes that happen and are reverted between two syncs. The last good snapshot remains available if OAuth expires, Google rate limits, or a network error prevents a later sync.
