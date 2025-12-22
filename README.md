# Placement Tracker

React + Vite frontend with an Express backend that talks to Postgres (Supabase in production). The backend auto-creates the tables (`companies`, `students`, `offers`).

## Prerequisites
- Node.js 18+ and npm
- Supabase (or any Postgres) connection details: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require`

## Setup
1) Backend
```bash
cd backend
cp .env.example .env   # fill with Supabase credentials
npm install
npm start               # runs on PORT (default 4000)
```

2) Frontend
```bash
cd frontend
npm install
npm run dev             # http://localhost:5173/Placement_Tracker/
```
- Dev proxy is already configured (`/api` → `http://localhost:4000`). If you run the API elsewhere, set `VITE_API_BASE` accordingly.

## Data import (SQLite → Supabase)
- CSVs exported from the legacy SQLite DB live in `exports/backend_companies.csv`, `exports/backend_students.csv`, `exports/backend_offers.csv` (order: companies → students → offers).
- Detailed steps are in `backend/IMPORT_SQLITE.md` (UI import and `psql` commands).

## Admin login
- Defaults (can override via env):
	- `ADMIN_EMAIL=yash25091@iiitd.ac.in`
	- `ADMIN_PASSWORD=***REMOVED***`
- Set your own in `backend/.env` if desired.