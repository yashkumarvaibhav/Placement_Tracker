# Import existing SQLite data into Supabase Postgres

You only need your current SQLite file (e.g., `data.sqlite`) and the Supabase connection string.

## 1) Export CSVs from SQLite (runs locally)
```bash
# companies
sqlite3 data.sqlite <<'SQL'
.headers on
.mode csv
.output companies.csv
SELECT * FROM companies;
.output stdout
SQL

# students
sqlite3 data.sqlite <<'SQL'
.headers on
.mode csv
.output students.csv
SELECT * FROM students;
.output stdout
SQL

# offers
sqlite3 data.sqlite <<'SQL'
.headers on
.mode csv
.output offers.csv
SELECT * FROM offers;
.output stdout
SQL
```

## 2) Import into Supabase
Pick one method.

### A) Supabase UI (easiest)
1. In Supabase, go to **Table Editor** → open `companies` → **Import** → upload `companies.csv`.
2. Repeat for `students` and then `offers` (this order preserves foreign keys).

### B) Via `psql` from your machine
```bash
psql "postgresql://postgres:<YOUR-PASSWORD>@db.bqldotdtsodmfmnxwavl.supabase.co:5432/postgres?sslmode=require" \
  -c "\\copy companies FROM 'companies.csv' CSV HEADER" \
  -c "\\copy students FROM 'students.csv' CSV HEADER" \
  -c "\\copy offers FROM 'offers.csv' CSV HEADER"
```

## Notes
- Do **not** upload the SQLite file to Render; data lives in Supabase.
- Import order matters: companies → students → offers.
- If your column order differs from Supabase tables, adjust the `SELECT` in the export to match the Postgres schema.
