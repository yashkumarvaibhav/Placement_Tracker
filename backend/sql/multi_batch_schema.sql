ALTER TABLE companies ADD COLUMN IF NOT EXISTS batch_key TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS degree TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS graduation_year INTEGER;

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