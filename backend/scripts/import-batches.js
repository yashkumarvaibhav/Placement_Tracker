import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const ROSTER_IMPORTS = [
  {
    batch_key: 'mtech-2026',
    degree: 'M.Tech',
    graduation_year: 2026,
    file: 'M.Tech 2024 _ FT.xlsx',
    prune_missing_unplaced: false,
  },
  {
    batch_key: 'mtech-2027',
    degree: 'M.Tech',
    graduation_year: 2027,
    file: 'Placements Registration for M.Tech (2027 Passout Batch) (1).xlsx',
    prune_missing_unplaced: true,
  },
  {
    batch_key: 'btech-2026',
    degree: 'B.Tech',
    graduation_year: 2026,
    file: 'B.Tech 2022_FT (1).xlsx',
    prune_missing_unplaced: true,
  },
  {
    batch_key: 'btech-2027',
    degree: 'B.Tech',
    graduation_year: 2027,
    file: 'Placements Registration for B.Tech  (2027 Passout).xlsx',
    prune_missing_unplaced: true,
  },
];

const normalizeProgram = (programRaw = '') => {
  const normalized = String(programRaw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (normalized.startsWith('CSE R') || normalized.includes('CSE RESEARCH')) return 'CSE-R';
  if (normalized.startsWith('CSE')) return 'CSE';
  if (normalized.startsWith('ECE')) return 'ECE';
  if (normalized.startsWith('CB')) return 'CB';
  return String(programRaw || '').trim().toUpperCase();
};

const toRollNumber = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(Math.trunc(value));
  return String(value).trim();
};

const findValue = (row, candidates) => {
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candidates.includes(normalized)) return value;
  }
  return '';
};

const readRoster = (fileName) => {
  const workbook = XLSX.readFile(path.join(repoRoot, fileName), { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows
    .map((row) => ({
      roll_number: toRollNumber(findValue(row, ['rollno', 'rollnumber'])),
      name: String(findValue(row, ['name']) || '').trim(),
      program: normalizeProgram(findValue(row, ['stream', 'program'])),
      email: String(findValue(row, ['emailaddress', 'email']) || '').trim().toLowerCase(),
      gender: String(findValue(row, ['gender']) || '').trim(),
      source_batch: String(findValue(row, ['batch']) || '').trim(),
    }))
    .filter((row) => row.roll_number && row.name && row.program);
};

const buildClientConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    };
  }

  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  };
};

const assertConnectionConfig = () => {
  if (process.env.DATABASE_URL) return;
  const required = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing database env vars: ${missing.join(', ')}`);
  }
};

const clearOffersForStudent = async (client, studentId) => {
  await client.query('DELETE FROM offers WHERE student_id = $1', [studentId]);
};

const upsertStudent = async (client, batchConfig, student) => {
  const existing = await client.query(
    `SELECT id, placement_status, company_id
     FROM students
     WHERE batch_key = $1 AND roll_number = $2
     LIMIT 1`,
    [batchConfig.batch_key, student.roll_number]
  );

  if (!existing.rowCount) {
    await client.query(
      `INSERT INTO students (
        roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend,
        registration_deadline, offer_date, batch_key, degree, graduation_year
      ) VALUES ($1, $2, $3, 'Unplaced', NULL, NULL, NULL, NULL, NULL, NULL, $4, $5, $6)`,
      [
        student.roll_number,
        student.name,
        student.program,
        batchConfig.batch_key,
        batchConfig.degree,
        batchConfig.graduation_year,
      ]
    );
    return { created: 1, updated: 0, preserved: 0 };
  }

  const row = existing.rows[0];
  const preservePlacement = row.placement_status === 'Placed' || row.company_id !== null;

  await client.query(
    `UPDATE students
     SET name = $1,
         program = $2,
         batch_key = $3,
         degree = $4,
         graduation_year = $5,
         placement_status = CASE WHEN $6 THEN placement_status ELSE 'Unplaced' END,
         company_id = CASE WHEN $6 THEN company_id ELSE NULL END,
         offer_type = CASE WHEN $6 THEN offer_type ELSE NULL END,
         ctc = CASE WHEN $6 THEN ctc ELSE NULL END,
         stipend = CASE WHEN $6 THEN stipend ELSE NULL END,
         registration_deadline = CASE WHEN $6 THEN registration_deadline ELSE NULL END,
         offer_date = CASE WHEN $6 THEN offer_date ELSE NULL END
     WHERE id = $7`,
    [
      student.name,
      student.program,
      batchConfig.batch_key,
      batchConfig.degree,
      batchConfig.graduation_year,
      preservePlacement,
      row.id,
    ]
  );

  if (!preservePlacement) {
    await clearOffersForStudent(client, row.id);
  }

  return {
    created: 0,
    updated: preservePlacement ? 0 : 1,
    preserved: preservePlacement ? 1 : 0,
  };
};

const pruneMissingUnplacedStudents = async (client, batchConfig, rosterRolls) => {
  const result = await client.query(
    `SELECT s.id, s.roll_number, s.placement_status, s.company_id, COUNT(o.id) AS offer_count
     FROM students s
     LEFT JOIN offers o ON o.student_id = s.id
     WHERE s.batch_key = $1
     GROUP BY s.id`,
    [batchConfig.batch_key]
  );

  let deleted = 0;
  let retained = 0;

  for (const row of result.rows) {
    if (rosterRolls.has(row.roll_number)) continue;
    const hasOffers = Number(row.offer_count || 0) > 0;
    const preserve = row.placement_status === 'Placed' || row.company_id !== null || hasOffers;

    if (preserve) {
      retained += 1;
      continue;
    }

    await client.query('DELETE FROM students WHERE id = $1', [row.id]);
    deleted += 1;
  }

  return { deleted, retained };
};

const main = async () => {
  assertConnectionConfig();

  const client = new Client(buildClientConfig());
  await client.connect();

  try {
    const schemaSql = fs.readFileSync(path.join(repoRoot, 'backend/sql/multi_batch_schema.sql'), 'utf8');
    await client.query(schemaSql);

    for (const batchConfig of ROSTER_IMPORTS) {
      const roster = readRoster(batchConfig.file);
      const rosterRolls = new Set(roster.map((student) => student.roll_number));
      let created = 0;
      let updated = 0;
      let preserved = 0;

      await client.query('BEGIN');
      for (const student of roster) {
        const counts = await upsertStudent(client, batchConfig, student);
        created += counts.created;
        updated += counts.updated;
        preserved += counts.preserved;
      }

      let deleted = 0;
      let retained = 0;
      if (batchConfig.prune_missing_unplaced) {
        const pruneCounts = await pruneMissingUnplacedStudents(client, batchConfig, rosterRolls);
        deleted = pruneCounts.deleted;
        retained = pruneCounts.retained;
      }
      await client.query('COMMIT');

      console.log(`${batchConfig.batch_key}: roster=${roster.length}, created=${created}, updated=${updated}, preserved=${preserved}, deleted_missing_unplaced=${deleted}, retained_missing_placed=${retained}`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});