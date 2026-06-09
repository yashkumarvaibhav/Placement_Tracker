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
- `gwiz-tunnel.service` publishes both `yashkumarvaibhav.me` and `placement-atlas.yashkumarvaibhav.me` through Cloudflare Tunnel.
- The portfolio is served from `yashkumarvaibhav.me`. Placement Atlas is served from `placement-atlas.yashkumarvaibhav.me`.
- Requests to `yashkumarvaibhav.me/Placement_Tracker/` permanently redirect to the Placement Atlas subdomain.

## Viewer access
- Google sign-in is verified by the backend against `GOOGLE_CLIENT_ID` and the `iiitd.ac.in` hosted domain.
- Initial shared viewer credentials are configured with `VIEWER_USERNAME` and `VIEWER_PASSWORD`, then seeded into the database as an Argon2id hash.
- An authenticated admin can replace the shared viewer username and password from the Admin page. Updated passwords are stored as Argon2id hashes.
- The email address is used transiently for domain verification. It is not stored, logged, or returned to the frontend.
- Read access to placement data requires a signed viewer session. Configure a stable `SESSION_SECRET` in `backend/.env`.

## Admin login
- `yash25091@iiitd.ac.in` automatically receives admin access after a successful IIIT Delhi Google sign-in.
- There is no separate admin password or TOTP login endpoint.
