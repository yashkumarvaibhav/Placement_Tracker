import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { closeDb, initDb, query } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const apply = process.argv.includes('--apply');

const ROSTERS = [
  ['mtech-2026', 'M.Tech 2024 _ FT.xlsx'],
  ['mtech-2027', 'Placements Registration for M.Tech (2027 Passout Batch) (1).xlsx'],
  ['btech-2026', 'B.Tech 2022_FT (1).xlsx'],
  ['btech-2027', 'Placements Registration for B.Tech  (2027 Passout).xlsx'],
];

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
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
    .map((row) => ({
      email: String(findValue(row, ['email', 'emailaddress']) || '').trim().toLowerCase(),
      name: String(findValue(row, ['name']) || '').trim(),
      rollNumber: typeof findValue(row, ['rollno', 'rollnumber']) === 'number'
        ? String(Math.trunc(findValue(row, ['rollno', 'rollnumber'])))
        : String(findValue(row, ['rollno', 'rollnumber']) || '').trim(),
    }))
    .filter((row) => row.email && row.rollNumber);
};

const main = async () => {
  if (apply) await initDb();

  let matched = 0;
  let missing = 0;
  let written = 0;
  const missingRows = [];
  const seenEmails = new Set();

  for (const [batchKey, fileName] of ROSTERS) {
    const roster = readRoster(fileName);
    for (const person of roster) {
      if (seenEmails.has(person.email)) continue;
      seenEmails.add(person.email);
      let { rows } = await query(
        'SELECT id FROM students WHERE batch_key = $1 AND roll_number = $2 LIMIT 1',
        [batchKey, person.rollNumber]
      );
      if (!rows[0] && person.name) {
        const byName = await query(
          `SELECT id FROM students
           WHERE batch_key = $1 AND lower(trim(name)) = lower(trim($2))
           ORDER BY id
           LIMIT 2`,
          [batchKey, person.name]
        );
        // The exact-name fallback repairs demonstrably malformed roster roll cells, but only
        // when the match is unique inside the batch.
        if (byName.rows.length === 1) rows = byName.rows;
      }
      const studentId = rows[0]?.id;
      if (!studentId) {
        missing += 1;
        missingRows.push({ batch_key: batchKey, roll_number: person.rollNumber, email: person.email });
        continue;
      }
      matched += 1;
      if (apply) {
        await query(
          `INSERT INTO student_rating_identities (email, student_id)
           VALUES ($1, $2)
           ON CONFLICT (email) DO UPDATE SET student_id = EXCLUDED.student_id`,
          [person.email, studentId]
        );
        written += 1;
      }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    matched,
    missing,
    written,
    missing_rows: missingRows,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
