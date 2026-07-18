import { query } from './client.js';

export const initDb = async () => {
  await query(`CREATE TABLE IF NOT EXISTS companies (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      type TEXT CHECK(type IN ('Intern','FTE','Intern+FTE','Summer Intern + FTE','Summer Intern + PPO','Summer Intern','Intern + PPO')),
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      category TEXT,
      eligible_cgpa DOUBLE PRECISION,
      backlog_allowed BOOLEAN DEFAULT false,
      registration_deadline TEXT,
      registration_open_date TEXT,
      offer_date TEXT,
      branches TEXT[],
      roles JSONB,
      batch_key TEXT,
      degree TEXT,
      graduation_year INTEGER
    );`);

  await query(`CREATE TABLE IF NOT EXISTS students (
      id BIGSERIAL PRIMARY KEY,
      roll_number TEXT NOT NULL,
      name TEXT NOT NULL,
      program TEXT NOT NULL,
      placement_status TEXT CHECK(placement_status IN ('Placed','Unplaced','Ineligible','Not Sitting')) NOT NULL,
      company_id BIGINT REFERENCES companies(id),
      offer_type TEXT,
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      registration_deadline TEXT,
      offer_date TEXT,
      batch_key TEXT,
      degree TEXT,
      graduation_year INTEGER
    );`);

  await query(`CREATE TABLE IF NOT EXISTS offers (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      company_id BIGINT NOT NULL REFERENCES companies(id),
      offer_type TEXT,
      role TEXT,
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      registration_deadline TEXT,
      offer_date TEXT
    );`);

  await query(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);

  await query(`CREATE TABLE IF NOT EXISTS placement_calendar_snapshots (
      id BIGSERIAL PRIMARY KEY,
      version INTEGER UNIQUE NOT NULL,
      source_spreadsheet_id TEXT NOT NULL,
      source_sheet_id INTEGER,
      source_sheet_title TEXT,
      source_range TEXT,
      content_hash TEXT UNIQUE NOT NULL,
      total_row_count INTEGER NOT NULL DEFAULT 0,
      visible_row_count INTEGER NOT NULL DEFAULT 0,
      hidden_row_count INTEGER NOT NULL DEFAULT 0,
      total_event_count INTEGER NOT NULL DEFAULT 0,
      visible_event_count INTEGER NOT NULL DEFAULT 0,
      hidden_event_count INTEGER NOT NULL DEFAULT 0,
      raw_snapshot JSONB NOT NULL,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);

  await query(`CREATE TABLE IF NOT EXISTS placement_calendar_rows (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id BIGINT NOT NULL REFERENCES placement_calendar_snapshots(id) ON DELETE CASCADE,
      source_row_index INTEGER NOT NULL,
      source_row_number INTEGER NOT NULL,
      row_hash TEXT NOT NULL,
      hidden_by_user BOOLEAN NOT NULL DEFAULT false,
      hidden_by_filter BOOLEAN NOT NULL DEFAULT false,
      hidden BOOLEAN NOT NULL DEFAULT false,
      display_values JSONB NOT NULL,
      cells JSONB NOT NULL,
      normalized JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(snapshot_id, source_row_index)
    );`);

  await query(`CREATE TABLE IF NOT EXISTS placement_calendar_events (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id BIGINT NOT NULL REFERENCES placement_calendar_snapshots(id) ON DELETE CASCADE,
      row_id BIGINT REFERENCES placement_calendar_rows(id) ON DELETE SET NULL,
      source_row_number INTEGER NOT NULL,
      event_hash TEXT NOT NULL,
      title TEXT,
      company TEXT,
      event_type TEXT,
      starts_on DATE,
      ends_on DATE,
      deadline_on DATE,
      status TEXT,
      batches TEXT[],
      branches TEXT[],
      notes TEXT,
      hidden BOOLEAN NOT NULL DEFAULT false,
      raw_event JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);

  await query('CREATE INDEX IF NOT EXISTS idx_offers_student_id ON offers(student_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_offers_company_id ON offers(company_id);');
  // One offer per (student, company) is an application rule; enforce it in the schema.
  // Dedupe first so the unique index can build on legacy data (keep the oldest row).
  await query(`DELETE FROM offers a USING offers b
     WHERE a.student_id = b.student_id AND a.company_id = b.company_id AND a.id > b.id;`);
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_offers_student_company ON offers(student_id, company_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_calendar_snapshots_created_at ON placement_calendar_snapshots(created_at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_calendar_rows_snapshot_id ON placement_calendar_rows(snapshot_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_calendar_events_snapshot_id ON placement_calendar_events(snapshot_id);');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS batch_key TEXT;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS degree TEXT;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS graduation_year INTEGER;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS reported_offer_count INTEGER;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS registration_open_date TEXT;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS branches TEXT[];');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS roles JSONB;');
  await query('ALTER TABLE offers ADD COLUMN IF NOT EXISTS role TEXT;');
  await query('ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_type_check;');
  await query(`ALTER TABLE companies ADD CONSTRAINT companies_type_check
    CHECK(type IN ('Intern','FTE','Intern+FTE','Summer Intern + FTE','Summer Intern + PPO','Summer Intern','Intern + PPO'));`);
  await query('ALTER TABLE students ADD COLUMN IF NOT EXISTS batch_key TEXT;');
  await query('ALTER TABLE students ADD COLUMN IF NOT EXISTS degree TEXT;');
  await query('ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_year INTEGER;');
  await query('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_roll_number_key;');
  await query('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_placement_status_check;');
  await query(`ALTER TABLE students
    ADD CONSTRAINT students_placement_status_check
    CHECK(placement_status IN ('Placed','Unplaced','Ineligible','Not Sitting'));`);
  await query(`UPDATE companies
    SET batch_key = COALESCE(batch_key, 'mtech-2026'),
        degree = COALESCE(degree, 'M.Tech'),
        graduation_year = COALESCE(graduation_year, 2026)`);
  await query(`UPDATE students
    SET batch_key = COALESCE(batch_key, 'mtech-2026'),
        degree = COALESCE(degree, 'M.Tech'),
        graduation_year = COALESCE(graduation_year, 2026)`);
  await query('CREATE INDEX IF NOT EXISTS idx_companies_batch_key ON companies(batch_key);');
  await query('CREATE INDEX IF NOT EXISTS idx_students_batch_key ON students(batch_key);');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_batch_roll_unique ON students(batch_key, roll_number);');
};

const backfillOffers = async () => {
  const { rows } = await query(
    `SELECT s.id as student_id, s.company_id, s.offer_type, s.ctc, s.stipend, s.registration_deadline, s.offer_date
     FROM students s
     WHERE s.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.student_id = s.id)`
  );

  for (const row of rows) {
    await query(
      `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.student_id,
        row.company_id,
        row.offer_type || null,
        row.ctc ?? null,
        row.stipend ?? null,
        row.registration_deadline || null,
        row.offer_date || null,
      ]
    );
  }
};

export const ensureOfferBackfill = backfillOffers;

export const getTableCounts = async () => {
  const [companies, students, offers, calendarSnapshots] = await Promise.all([
    query('SELECT count(*)::int AS count FROM companies'),
    query('SELECT count(*)::int AS count FROM students'),
    query('SELECT count(*)::int AS count FROM offers'),
    query('SELECT count(*)::int AS count FROM placement_calendar_snapshots'),
  ]);

  return {
    companies: companies.rows[0]?.count ?? 0,
    students: students.rows[0]?.count ?? 0,
    offers: offers.rows[0]?.count ?? 0,
    placement_calendar_snapshots: calendarSnapshots.rows[0]?.count ?? 0,
  };
};
