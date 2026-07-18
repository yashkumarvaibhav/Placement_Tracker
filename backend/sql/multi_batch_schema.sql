ALTER TABLE companies ADD COLUMN IF NOT EXISTS batch_key TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS degree TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS graduation_year INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS reported_offer_count INTEGER;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_type_check;
ALTER TABLE companies ADD CONSTRAINT companies_type_check CHECK (
    type IN ('Intern', 'FTE', 'Intern+FTE', 'Summer Intern + FTE', 'Summer Intern + PPO', 'Summer Intern', 'Intern + PPO')
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS batch_key TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS degree TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_year INTEGER;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_roll_number_key;

UPDATE companies
SET batch_key = COALESCE(batch_key, 'mtech-2026'),
    degree = COALESCE(degree, 'M.Tech'),
    graduation_year = COALESCE(graduation_year, 2026);

UPDATE students
SET batch_key = COALESCE(batch_key, 'mtech-2026'),
    degree = COALESCE(degree, 'M.Tech'),
    graduation_year = COALESCE(graduation_year, 2026);

CREATE INDEX IF NOT EXISTS idx_companies_batch_key ON companies(batch_key);
CREATE INDEX IF NOT EXISTS idx_students_batch_key ON students(batch_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_batch_roll_unique ON students(batch_key, roll_number);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS placement_calendar_snapshots (
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
);

CREATE TABLE IF NOT EXISTS placement_calendar_rows (
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
);

CREATE TABLE IF NOT EXISTS placement_calendar_events (
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
);

CREATE INDEX IF NOT EXISTS idx_calendar_snapshots_created_at ON placement_calendar_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_rows_snapshot_id ON placement_calendar_rows(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_snapshot_id ON placement_calendar_events(snapshot_id);

SELECT setval(
    pg_get_serial_sequence('companies', 'id'),
    GREATEST(COALESCE((SELECT MAX(id) FROM companies), 0), 1),
    true
);

SELECT setval(
    pg_get_serial_sequence('students', 'id'),
    GREATEST(COALESCE((SELECT MAX(id) FROM students), 0), 1),
    true
);

SELECT setval(
    pg_get_serial_sequence('offers', 'id'),
    GREATEST(COALESCE((SELECT MAX(id) FROM offers), 0), 1),
    true
);
