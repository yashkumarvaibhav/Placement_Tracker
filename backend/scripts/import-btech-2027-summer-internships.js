import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import XLSX from 'xlsx';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const sourceFile = 'IIIT Delhi _ B.Tech SummerPlacements_batch-2027 - Sheet.csv';
const batch = { key: 'btech-2027', degree: 'B.Tech', graduationYear: 2027 };

const buildClientConfig = () => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const readSource = () => {
  const workbook = XLSX.readFile(path.join(repoRoot, sourceFile), { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const records = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const serial = clean(row[0]);
    const rollNumber = clean(row[1]);
    if (!/^\d+$/.test(serial) || !/^2023\d+$/.test(rollNumber)) continue;

    let name = clean(row[2]);
    let company = clean(row[3]);
    let stipend = Number(row[4]);

    // Three wrapped spreadsheet records continue name and company/stipend on following rows.
    if (!name && !company) {
      name = clean(rows[index + 1]?.[0]);
      company = clean(rows[index + 2]?.[0]);
      stipend = Number(rows[index + 2]?.[1]);
      index += 2;
    }

    if (!name || !company || !Number.isFinite(stipend) || stipend <= 0) {
      throw new Error(`Invalid internship record near source row ${index + 1}`);
    }

    records.push({ roll_number: rollNumber, name, company, stipend });
  }

  const keys = new Set();
  for (const record of records) {
    const key = `${record.roll_number}|${normalize(record.company)}`;
    if (keys.has(key)) throw new Error(`Duplicate student-company internship: ${key}`);
    keys.add(key);
  }

  return records;
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const records = readSource();
  const client = new Client(buildClientConfig());
  await client.connect();

  const report = {
    mode: apply ? 'applied' : 'dry-run',
    source_rows: records.length,
    unique_students: new Set(records.map((record) => record.roll_number)).size,
    source_companies: new Set(records.map((record) => normalize(record.company))).size,
    created_students: 0,
    created_companies: 0,
    created_offers: 0,
    existing_offers_preserved: 0,
    stipends_filled: 0,
    companies_marked_aplus: 0,
    students_marked_placed: 0,
    students_created_without_program: [],
  };

  await client.query('BEGIN');
  try {
    const schema = fs.readFileSync(path.join(repoRoot, 'backend/sql/multi_batch_schema.sql'), 'utf8');
    await client.query(schema);

    const { rows: existingStudents } = await client.query(
      'SELECT * FROM students WHERE batch_key = $1',
      [batch.key]
    );
    const { rows: existingCompanies } = await client.query(
      'SELECT * FROM companies WHERE batch_key = $1',
      [batch.key]
    );
    const { rows: existingOffers } = await client.query(
      `SELECT o.*, s.roll_number, c.name AS company_name
       FROM offers o
       JOIN students s ON s.id = o.student_id
       JOIN companies c ON c.id = o.company_id
       WHERE s.batch_key = $1`,
      [batch.key]
    );

    const studentsByRoll = new Map(existingStudents.map((student) => [student.roll_number, student]));
    const companiesByName = new Map(existingCompanies.map((company) => [normalize(company.name), company]));
    const offersByKey = new Map(existingOffers.map((offer) => [
      `${offer.roll_number}|${normalize(offer.company_name)}`,
      offer,
    ]));

    for (const record of records) {
      let student = studentsByRoll.get(record.roll_number);
      if (!student) {
        const { rows } = await client.query(
          `INSERT INTO students (
            roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend,
            registration_deadline, offer_date, batch_key, degree, graduation_year
          ) VALUES ($1, $2, 'OTHER', 'Placed', NULL, NULL, NULL, NULL, NULL, NULL, $3, $4, $5)
          RETURNING *`,
          [record.roll_number, record.name, batch.key, batch.degree, batch.graduationYear]
        );
        student = rows[0];
        studentsByRoll.set(record.roll_number, student);
        report.created_students += 1;
        report.students_created_without_program.push({
          roll_number: record.roll_number,
          name: record.name,
        });
      } else if (normalize(student.name) !== normalize(record.name)) {
        throw new Error(`Name mismatch for ${record.roll_number}: roster=${student.name}, source=${record.name}`);
      }

      let company = companiesByName.get(normalize(record.company));
      if (!company) {
        const { rows } = await client.query(
          `INSERT INTO companies (
            name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed,
            registration_deadline, offer_date, batch_key, degree, graduation_year
          ) VALUES ($1, 'Summer Internship', 'Summer Intern', NULL, $2, 'A+', NULL, false, NULL, NULL, $3, $4, $5)
          RETURNING *`,
          [record.company, record.stipend, batch.key, batch.degree, batch.graduationYear]
        );
        company = rows[0];
        companiesByName.set(normalize(record.company), company);
        report.created_companies += 1;
      } else {
        const updates = [];
        const values = [];
        if (!company.type) {
          values.push('Summer Intern');
          updates.push(`type = $${values.length}`);
        }
        if (company.stipend === null || company.stipend === undefined) {
          values.push(record.stipend);
          updates.push(`stipend = $${values.length}`);
          report.stipends_filled += 1;
        }
        if (company.category !== 'A+') {
          values.push('A+');
          updates.push(`category = $${values.length}`);
          report.companies_marked_aplus += 1;
        }
        if (updates.length) {
          values.push(company.id);
          const { rows } = await client.query(
            `UPDATE companies SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
          );
          company = rows[0];
          companiesByName.set(normalize(record.company), company);
        }
      }

      const offerKey = `${record.roll_number}|${normalize(record.company)}`;
      const existingOffer = offersByKey.get(offerKey);
      let offer = existingOffer;
      if (!existingOffer) {
        const { rows } = await client.query(
          `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
           VALUES ($1, $2, 'Summer Intern', NULL, $3, NULL, NULL)
           RETURNING *`,
          [student.id, company.id, record.stipend]
        );
        offer = rows[0];
        offersByKey.set(offerKey, offer);
        report.created_offers += 1;
      } else {
        report.existing_offers_preserved += 1;
        if (existingOffer.stipend === null || existingOffer.stipend === undefined) {
          await client.query('UPDATE offers SET stipend = $1 WHERE id = $2', [record.stipend, existingOffer.id]);
          offer = { ...existingOffer, stipend: record.stipend };
          report.stipends_filled += 1;
        }
      }

      if (student.placement_status !== 'Placed') {
        await client.query("UPDATE students SET placement_status = 'Placed' WHERE id = $1", [student.id]);
        report.students_marked_placed += 1;
      }

      if (!student.company_id) {
        await client.query(
          `UPDATE students
           SET company_id = $1, offer_type = $2, stipend = $3
           WHERE id = $4`,
          [company.id, offer.offer_type || 'Summer Intern', offer.stipend ?? record.stipend, student.id]
        );
      }
    }

    if (apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');
    console.log(JSON.stringify(report, null, 2));
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
