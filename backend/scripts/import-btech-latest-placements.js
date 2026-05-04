import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const TARGET_BATCH = {
  batch_key: 'btech-2026',
  degree: 'B.Tech',
  graduation_year: 2026,
};

const PLACEHOLDER_ROLE = 'SWE - Placeholder';
const PLACEHOLDER_PROGRAM = 'OTHER';
const HEADING_PATTERN = /\boffer(?:s)?\b/i;
const TRAILING_DASH_PATTERN = /[-–—]\s*$/;
const ROLL_PATTERN = /^(MT)?\d{4,}$/i;

const normalizeLine = (value = '') => String(value)
  .replace(/\u00a0/g, ' ')
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

const sanitizeCompanyName = (value = '') => normalizeLine(value)
  .replace(/\bPPO\b/gi, '')
  .replace(/\boffer(?:s)?\b/gi, '')
  .replace(TRAILING_DASH_PATTERN, '')
  .replace(/\s+/g, ' ')
  .trim();

const isHeadingLine = (value = '', nextValue = '') => {
  const normalized = normalizeLine(value);
  return HEADING_PATTERN.test(normalized) && (TRAILING_DASH_PATTERN.test(normalized) || isRollNumber(nextValue));
};

const isRollNumber = (value = '') => ROLL_PATTERN.test(normalizeLine(value));

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

const parsePlacementFile = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ lineNumber: index + 1, text: normalizeLine(line) }))
    .filter((line) => line.text);

  let currentCompany = null;
  const entries = [];
  const skippedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];

    if (isHeadingLine(line.text, next?.text)) {
      currentCompany = sanitizeCompanyName(line.text);
      continue;
    }

    if (isRollNumber(line.text)) {
      const hasName = next && !isRollNumber(next.text) && !isHeadingLine(next.text, lines[index + 2]?.text);
      entries.push({
        company: currentCompany,
        roll_number: line.text,
        name: hasName ? next.text : '',
        source_line: line.lineNumber,
      });
      if (hasName) {
        index += 1;
      }
      continue;
    }

    skippedLines.push({
      lineNumber: line.lineNumber,
      text: line.text,
      company: currentCompany,
    });
  }

  return { entries, skippedLines };
};

const buildBtechMapping = (entries) => {
  const studentMap = new Map();
  const companyOrder = [];
  const companySeen = new Set();
  let ignoredMtechEntries = 0;

  for (const entry of entries) {
    if (!entry.company) continue;

    if (/^MT/i.test(entry.roll_number)) {
      ignoredMtechEntries += 1;
      continue;
    }

    if (!companySeen.has(entry.company)) {
      companySeen.add(entry.company);
      companyOrder.push(entry.company);
    }

    const existing = studentMap.get(entry.roll_number) || {
      roll_number: entry.roll_number,
      name: entry.name || '',
      companies: [],
    };

    if (!existing.name && entry.name) {
      existing.name = entry.name;
    }

    if (!existing.companies.includes(entry.company)) {
      existing.companies.push(entry.company);
    }

    studentMap.set(entry.roll_number, existing);
  }

  return {
    companies: companyOrder,
    students: [...studentMap.values()],
    ignoredMtechEntries,
  };
};

const loadBatchStudents = async (client) => {
  const result = await client.query(
    `SELECT id, roll_number, name, program
     FROM students
     WHERE batch_key = $1
     ORDER BY id ASC`,
    [TARGET_BATCH.batch_key]
  );

  const byRoll = new Map();
  const byName = new Map();

  for (const row of result.rows) {
    byRoll.set(row.roll_number, row);

    const key = row.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  return { rows: result.rows, byRoll, byName };
};

const planStudentResolution = (mappedStudents, loadedStudents) => {
  const usedIds = new Set();
  const resolved = [];
  const correctedRolls = [];
  const createStudents = [];
  const unresolved = [];

  for (const student of mappedStudents) {
    const byRoll = loadedStudents.byRoll.get(student.roll_number);
    if (byRoll) {
      usedIds.add(byRoll.id);
      resolved.push({ student, existing: byRoll, mode: 'matched-roll' });
      continue;
    }

    const nameKey = student.name.trim().toLowerCase();
    const nameMatches = nameKey ? (loadedStudents.byName.get(nameKey) || []).filter((row) => !usedIds.has(row.id)) : [];
    if (nameMatches.length === 1) {
      const existing = nameMatches[0];
      usedIds.add(existing.id);
      correctedRolls.push({ id: existing.id, from: existing.roll_number, to: student.roll_number, name: existing.name });
      resolved.push({ student, existing, mode: 'matched-name' });
      continue;
    }

    if (!student.name) {
      unresolved.push({ roll_number: student.roll_number, companies: student.companies });
      continue;
    }

    createStudents.push(student);
    resolved.push({ student, existing: null, mode: 'create-student' });
  }

  return { resolved, correctedRolls, createStudents, unresolved };
};

const ensureSchema = async (client) => {
  const schemaSql = fs.readFileSync(path.join(repoRoot, 'backend/sql/multi_batch_schema.sql'), 'utf8');
  await client.query(schemaSql);
};

const insertCompany = async (client, companyName) => {
  const result = await client.query(
    `INSERT INTO companies (
      name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed,
      registration_deadline, offer_date, batch_key, degree, graduation_year
    ) VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, $3, $4, $5)
    RETURNING id`,
    [companyName, PLACEHOLDER_ROLE, TARGET_BATCH.batch_key, TARGET_BATCH.degree, TARGET_BATCH.graduation_year]
  );

  return result.rows[0].id;
};

const createStudent = async (client, student, primaryCompanyId) => {
  const result = await client.query(
    `INSERT INTO students (
      roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend,
      registration_deadline, offer_date, batch_key, degree, graduation_year
    ) VALUES ($1, $2, $3, 'Placed', $4, NULL, NULL, NULL, NULL, NULL, $5, $6, $7)
    RETURNING id`,
    [
      student.roll_number,
      student.name,
      PLACEHOLDER_PROGRAM,
      primaryCompanyId,
      TARGET_BATCH.batch_key,
      TARGET_BATCH.degree,
      TARGET_BATCH.graduation_year,
    ]
  );

  return result.rows[0].id;
};

const placeExistingStudent = async (client, studentId, primaryCompanyId) => {
  await client.query(
    `UPDATE students
     SET placement_status = 'Placed',
         company_id = $1,
         offer_type = NULL,
         ctc = NULL,
         stipend = NULL,
         registration_deadline = NULL,
         offer_date = NULL
     WHERE id = $2`,
    [primaryCompanyId, studentId]
  );
};

const insertOffer = async (client, studentId, companyId) => {
  await client.query(
    `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
     VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL)`,
    [studentId, companyId]
  );
};

const executeImport = async (client, plan, companies) => {
  await client.query('BEGIN');

  try {
    await client.query(
      `DELETE FROM offers
       WHERE student_id IN (SELECT id FROM students WHERE batch_key = $1)`,
      [TARGET_BATCH.batch_key]
    );

    await client.query(
      `UPDATE students
       SET placement_status = 'Unplaced',
           company_id = NULL,
           offer_type = NULL,
           ctc = NULL,
           stipend = NULL,
           registration_deadline = NULL,
           offer_date = NULL
       WHERE batch_key = $1`,
      [TARGET_BATCH.batch_key]
    );

    await client.query('DELETE FROM companies WHERE batch_key = $1', [TARGET_BATCH.batch_key]);

    for (const correction of plan.correctedRolls) {
      await client.query('UPDATE students SET roll_number = $1 WHERE id = $2', [correction.to, correction.id]);
    }

    const companyIds = new Map();
    for (const companyName of companies) {
      companyIds.set(companyName, await insertCompany(client, companyName));
    }

    let createdStudents = 0;
    let offersInserted = 0;

    for (const item of plan.resolved) {
      const primaryCompanyId = companyIds.get(item.student.companies[0]);
      let studentId = item.existing?.id;

      if (!studentId) {
        studentId = await createStudent(client, item.student, primaryCompanyId);
        createdStudents += 1;
      } else {
        await placeExistingStudent(client, studentId, primaryCompanyId);
      }

      for (const companyName of item.student.companies) {
        await insertOffer(client, studentId, companyIds.get(companyName));
        offersInserted += 1;
      }
    }

    await client.query('COMMIT');
    return { createdStudents, offersInserted, companyIds };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
};

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');
  assertConnectionConfig();

  const parsed = parsePlacementFile(path.join(repoRoot, 'latest-placement.txt'));
  const mapped = buildBtechMapping(parsed.entries);

  const client = new Client(buildClientConfig());
  await client.connect();

  try {
    await ensureSchema(client);
    const loadedStudents = await loadBatchStudents(client);
    const plan = planStudentResolution(mapped.students, loadedStudents);

    if (plan.unresolved.length) {
      throw new Error(`Unresolved students without roster or name: ${JSON.stringify(plan.unresolved.slice(0, 10))}`);
    }

    if (dryRun) {
      console.log(JSON.stringify({
        batch: TARGET_BATCH.batch_key,
        uniqueCompanies: mapped.companies.length,
        uniquePlacedStudents: mapped.students.length,
        ignoredMtechEntries: mapped.ignoredMtechEntries,
        matchedByRoll: plan.resolved.filter((item) => item.mode === 'matched-roll').length,
        correctedRolls: plan.correctedRolls,
        createStudents: plan.createStudents,
        skippedLineSample: parsed.skippedLines.slice(0, 20),
      }, null, 2));
      return;
    }

    const result = await executeImport(client, plan, mapped.companies);

    console.log(JSON.stringify({
      batch: TARGET_BATCH.batch_key,
      uniqueCompanies: mapped.companies.length,
      uniquePlacedStudents: mapped.students.length,
      ignoredMtechEntries: mapped.ignoredMtechEntries,
      matchedByRoll: plan.resolved.filter((item) => item.mode === 'matched-roll').length,
      correctedRolls: plan.correctedRolls,
      createdStudents: result.createdStudents,
      offersInserted: result.offersInserted,
      skippedLines: parsed.skippedLines.slice(0, 20),
    }, null, 2));
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});