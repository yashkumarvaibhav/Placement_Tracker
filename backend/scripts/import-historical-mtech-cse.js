import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import pg from 'pg';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const IMPORTS = [
  { batch_key: 'mtech-cse-2023', graduation_year: 2023, academic_year: '2022-23', file: 'IIIT Delhi _ M.Tech Placements 2025-26 - 2022-23.csv' },
  { batch_key: 'mtech-cse-2024', graduation_year: 2024, academic_year: '2023-24', file: 'IIIT Delhi _ M.Tech Placements 2025-26 - 2023-24.tsv' },
  { batch_key: 'mtech-2025', graduation_year: 2025, academic_year: '2024-25', file: 'IIIT Delhi _ M.Tech Placements 2025-26 - 2024-25.csv', merge_with_detailed: true },
];

const buildClientConfig = () => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const parseFile = (config) => {
  const workbook = XLSX.readFile(path.join(repoRoot, config.file), { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const totalCell = rows.flat().findIndex((value) => /total offers/i.test(String(value)));
  const flattened = rows.flat();
  const reportedTotal = totalCell >= 0 ? Number(flattened[totalCell + 1]) : NaN;
  const companies = new Map();

  for (const row of rows) {
    const name = String(row[0] || '').trim();
    const role = String(row[1] || '').trim();
    const offerCount = Number(row[2]);
    if (!name || /^year\s*-/i.test(name) || !Number.isFinite(offerCount)) continue;

    const key = normalizeKey(name);
    const existing = companies.get(key) || { name, roles: new Set(), offer_count: 0 };
    if (role) existing.roles.add(role);
    existing.offer_count += offerCount;
    companies.set(key, existing);
  }

  const parsed = [...companies.values()].map((company) => ({
    name: company.name,
    role: [...company.roles].join(' / '),
    offer_count: company.offer_count,
  }));
  const parsedTotal = parsed.reduce((sum, company) => sum + company.offer_count, 0);

  if (!Number.isFinite(reportedTotal) || reportedTotal !== parsedTotal) {
    throw new Error(`${config.academic_year}: reported total ${reportedTotal} does not match parsed total ${parsedTotal}`);
  }

  return { companies: parsed, total_offers: parsedTotal };
};

const main = async () => {
  const client = new Client(buildClientConfig());
  await client.connect();

  try {
    const schema = fs.readFileSync(path.join(repoRoot, 'backend/sql/multi_batch_schema.sql'), 'utf8');
    await client.query(schema);

    for (const config of IMPORTS) {
      const data = parseFile(config);
      await client.query('BEGIN');
      if (!config.merge_with_detailed) {
        await client.query('DELETE FROM companies WHERE batch_key = $1', [config.batch_key]);
      }

      const existingCompanies = config.merge_with_detailed
        ? await client.query('SELECT * FROM companies WHERE batch_key = $1', [config.batch_key])
        : { rows: [] };
      const existingByName = new Map(existingCompanies.rows.map((company) => [normalizeKey(company.name), company]));

      for (const company of data.companies) {
        const existing = existingByName.get(normalizeKey(company.name));
        if (existing) {
          await client.query(
            `UPDATE companies
             SET role = CASE WHEN role IS NULL OR role = '' OR role = 'Historical placement record' THEN $1 ELSE role END,
                 reported_offer_count = $2
             WHERE id = $3`,
            [company.role, company.offer_count, existing.id]
          );
          continue;
        }

        await client.query(
          `INSERT INTO companies (
            name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed,
            registration_deadline, offer_date, batch_key, degree, graduation_year, reported_offer_count
          ) VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, $3, 'M.Tech', $4, $5)`,
          [company.name, company.role, config.batch_key, config.graduation_year, company.offer_count]
        );
      }

      if (config.merge_with_detailed) {
        await client.query('DELETE FROM companies WHERE batch_key = $1', ['mtech-cse-2025']);
      }

      await client.query('COMMIT');
      console.log(`${config.batch_key}: companies=${data.companies.length}, companies_with_offers=${data.companies.filter((company) => company.offer_count > 0).length}, offers=${data.total_offers}`);
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
