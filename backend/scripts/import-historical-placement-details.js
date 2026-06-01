import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import XLSX from 'xlsx';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const reportPath = path.join(repoRoot, 'historical-placement-import-report.json');

const IMPORTS = [
  {
    batch_key: 'btech-2026',
    degree: 'B.Tech',
    graduation_year: 2026,
    file: 'IIIT Delhi - b.tech26.csv',
    roll_column: 'Roll no.',
    compensation_column: 'CTC',
    source_wins: true,
    type_map: { ppo: 'Intern + PPO', intern: 'Intern', offers: 'FTE' },
  },
  {
    batch_key: 'btech-2025',
    degree: 'B.Tech',
    graduation_year: 2025,
    file: 'IIIT Delhi- b.tech-batch2025.csv',
    roll_column: 'Roll Number',
    compensation_column: 'Compensation',
    type_map: {
      ppo: 'Intern + PPO',
      offer: 'FTE',
      'offer+intern': 'Intern+FTE',
      'intern only': 'Summer Intern',
    },
  },
  {
    batch_key: 'mtech-2025',
    degree: 'M.Tech',
    graduation_year: 2025,
    file: 'IIIT Delhi-m.tech-batch2025.csv',
    roll_column: 'Roll Number',
    compensation_column: 'Compensation',
    type_map: {
      ppo: 'Intern + PPO',
      offer: 'FTE',
      'offer+intern': 'Intern+FTE',
      '6 month': 'Intern',
    },
  },
];

const cleanText = (value = '') => String(value)
  .replace(/\u00a0/g, ' ')
  .replace(/[\u200b-\u200d\ufeff]/g, '')
  .replace(/â/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeKey = (value = '') => cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeProgram = (value = '') => {
  const normalized = cleanText(value).toUpperCase();
  if (!normalized) return '';
  if (normalized.startsWith('CSE RESEARCH') || normalized.startsWith('CSE R')) return 'CSE-R';
  return normalized;
};

const parseMoney = (value) => {
  const digits = cleanText(value).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) ? amount : null;
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

const readSource = (config) => {
  const workbook = XLSX.readFile(path.join(repoRoot, config.file), { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const seenOffers = new Set();
  const duplicateRows = [];
  const rows = [];

  for (const [index, row] of rawRows.entries()) {
    const sourceType = cleanText(row.Type);
    const parsed = {
      source_row: index + 2,
      roll_number: cleanText(row[config.roll_column]),
      name: cleanText(row.Student),
      program: normalizeProgram(row.Branch),
      company: cleanText(row.Company),
      source_type: sourceType,
      offer_type: config.type_map[sourceType.toLowerCase()] || '',
      ctc: parseMoney(row[config.compensation_column]),
    };

    if (!parsed.roll_number || !parsed.name || !parsed.company) continue;
    const fingerprint = [
      parsed.roll_number,
      normalizeKey(parsed.name),
      normalizeKey(parsed.company),
      normalizeKey(parsed.source_type),
      parsed.ctc ?? '',
    ].join('|');

    if (seenOffers.has(fingerprint)) {
      duplicateRows.push(parsed);
      continue;
    }

    seenOffers.add(fingerprint);
    rows.push(parsed);
  }

  const identitiesByRoll = new Map();
  for (const row of rows) {
    const identity = normalizeKey(row.name);
    if (!identitiesByRoll.has(row.roll_number)) identitiesByRoll.set(row.roll_number, new Map());
    identitiesByRoll.get(row.roll_number).set(identity, row.name);
  }

  const ambiguousRolls = new Map(
    [...identitiesByRoll].filter(([, identities]) => identities.size > 1)
  );

  const unambiguousRows = rows.filter((row) => !ambiguousRolls.has(row.roll_number));
  const rowsByStudentCompany = new Map();
  for (const row of unambiguousRows) {
    const key = `${row.roll_number}|${normalizeKey(row.company)}`;
    if (!rowsByStudentCompany.has(key)) rowsByStudentCompany.set(key, []);
    rowsByStudentCompany.get(key).push(row);
  }

  const consolidatedRows = [];
  const consolidatedOutcomes = [];
  for (const groupedRows of rowsByStudentCompany.values()) {
    const offerTypes = new Set(groupedRows.map((row) => row.offer_type).filter(Boolean));
    let combinedType = null;
    if (offerTypes.has('Summer Intern') && offerTypes.has('Intern + PPO')) combinedType = 'Summer Intern + PPO';
    else if (offerTypes.has('Intern') && offerTypes.has('Intern + PPO')) combinedType = 'Intern + PPO';
    else if (offerTypes.has('Intern') && offerTypes.has('FTE')) combinedType = 'Intern+FTE';

    if (!combinedType) {
      consolidatedRows.push(...groupedRows);
      continue;
    }

    const ctc = groupedRows.map((row) => row.ctc).find((value) => value !== null) ?? null;
    consolidatedRows.push({ ...groupedRows[groupedRows.length - 1], offer_type: combinedType, ctc });
    consolidatedOutcomes.push({
      roll_number: groupedRows[0].roll_number,
      student: groupedRows[0].name,
      company: groupedRows[0].company,
      source_types: groupedRows.map((row) => row.source_type),
      offer_type: combinedType,
    });
  }

  return {
    rows: consolidatedRows,
    duplicateRows,
    ambiguousRolls,
    consolidatedOutcomes,
    sourceRowCount: rawRows.length,
  };
};

const addConflict = (report, details, action = 'kept existing value') => {
  report.conflicts.push({ action, ...details });
};

const compareOrFill = async ({
  client,
  report,
  table,
  id,
  field,
  existing,
  incoming,
  context,
  sourceWins = false,
}) => {
  const existingBlank = existing === null || existing === undefined || cleanText(existing) === '';
  const incomingBlank = incoming === null || incoming === undefined || cleanText(incoming) === '';
  if (incomingBlank) return existing;

  if (existingBlank) {
    await client.query(`UPDATE ${table} SET ${field} = $1 WHERE id = $2`, [incoming, id]);
    report.filled_fields[field] = (report.filled_fields[field] || 0) + 1;
    return incoming;
  }

  const same = typeof incoming === 'number'
    ? Number(existing) === incoming
    : normalizeKey(existing) === normalizeKey(incoming);
  if (!same) {
    const action = sourceWins ? 'applied new CSV value' : 'kept existing value';
    addConflict(report, { ...context, field, existing, incoming }, action);
    if (sourceWins) {
      await client.query(`UPDATE ${table} SET ${field} = $1 WHERE id = $2`, [incoming, id]);
      report.updated_fields[field] = (report.updated_fields[field] || 0) + 1;
      return incoming;
    }
  }
  return existing;
};

const fillBlank = async ({ client, report, table, id, field, existing, incoming }) => {
  const existingBlank = existing === null || existing === undefined || cleanText(existing) === '';
  const incomingBlank = incoming === null || incoming === undefined || cleanText(incoming) === '';
  if (!existingBlank || incomingBlank) return existing;
  await client.query(`UPDATE ${table} SET ${field} = $1 WHERE id = $2`, [incoming, id]);
  report.filled_fields[field] = (report.filled_fields[field] || 0) + 1;
  return incoming;
};

const loadBatch = async (client, batchKey) => {
  const { rows: students } = await client.query(
    'SELECT * FROM students WHERE batch_key = $1 ORDER BY id',
    [batchKey]
  );
  const { rows: companies } = await client.query(
    'SELECT * FROM companies WHERE batch_key = $1 ORDER BY id',
    [batchKey]
  );
  const { rows: offers } = await client.query(
    `SELECT o.*, c.name AS company_name
     FROM offers o
     JOIN students s ON s.id = o.student_id
     JOIN companies c ON c.id = o.company_id
     WHERE s.batch_key = $1
     ORDER BY o.id`,
    [batchKey]
  );

  return { students, companies, offers };
};

const summarizeCompanies = (rows) => {
  const companies = new Map();
  for (const row of rows) {
    const key = normalizeKey(row.company);
    const summary = companies.get(key) || {
      name: row.company,
      offerTypes: new Set(),
      ctcValues: new Set(),
    };
    if (row.offer_type) summary.offerTypes.add(row.offer_type);
    if (row.ctc !== null) summary.ctcValues.add(row.ctc);
    companies.set(key, summary);
  }
  return companies;
};

const importBatch = async (client, config, source, apply) => {
  const report = {
    batch_key: config.batch_key,
    file: config.file,
    source_rows: source.sourceRowCount,
    usable_rows: source.rows.length,
    exact_duplicates_skipped: source.duplicateRows.length,
    consolidated_outcomes: source.consolidatedOutcomes,
    ambiguous_rolls_skipped: [...source.ambiguousRolls].map(([roll_number, identities]) => ({
      roll_number,
      names: [...identities.values()],
    })),
    created_students: 0,
    created_companies: 0,
    created_offers: 0,
    replaced_offers: 0,
    deleted_orphan_companies: 0,
    filled_fields: {},
    updated_fields: {},
    conflicts: [],
    preserved_earlier_only_offers: [],
  };

  await client.query('BEGIN');
  try {
    const loaded = await loadBatch(client, config.batch_key);
    const studentsByRoll = new Map(loaded.students.map((row) => [row.roll_number, row]));
    const companiesByKey = new Map(loaded.companies.map((row) => [normalizeKey(row.name), row]));
    const offersByStudent = new Map();
    for (const offer of loaded.offers) {
      if (!offersByStudent.has(String(offer.student_id))) offersByStudent.set(String(offer.student_id), []);
      offersByStudent.get(String(offer.student_id)).push(offer);
    }

    const sourceOfferKeys = new Set(source.rows.map((row) => `${row.roll_number}|${normalizeKey(row.company)}`));
    const studentsById = new Map(loaded.students.map((student) => [String(student.id), student]));
    for (const offer of loaded.offers) {
      const student = studentsById.get(String(offer.student_id));
      if (!student || sourceOfferKeys.has(`${student.roll_number}|${normalizeKey(offer.company_name)}`)) continue;
      report.preserved_earlier_only_offers.push({
        roll_number: student.roll_number,
        student: student.name,
        company: offer.company_name,
        offer_type: offer.offer_type,
        ctc: offer.ctc,
      });
    }

    const sourceCompanies = summarizeCompanies(source.rows);
    for (const [key, summary] of sourceCompanies) {
      const uniformType = summary.offerTypes.size === 1 ? [...summary.offerTypes][0] : null;
      const uniformCtc = summary.ctcValues.size === 1 ? [...summary.ctcValues][0] : null;
      let company = companiesByKey.get(key);

      if (!company) {
        const { rows } = await client.query(
          `INSERT INTO companies (
            name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed,
            registration_deadline, offer_date, batch_key, degree, graduation_year
          ) VALUES ($1, 'Historical placement record', $2, $3, NULL, NULL, NULL, false, NULL, NULL, $4, $5, $6)
          RETURNING *`,
          [summary.name, uniformType, uniformCtc, config.batch_key, config.degree, config.graduation_year]
        );
        company = rows[0];
        companiesByKey.set(key, company);
        report.created_companies += 1;
      } else if (company) {
        company.type = await compareOrFill({
          client, report, table: 'companies', id: company.id, field: 'type',
          existing: company.type, incoming: uniformType,
          context: { entity: 'company', company: company.name },
          sourceWins: config.source_wins,
        });
        company.ctc = await compareOrFill({
          client, report, table: 'companies', id: company.id, field: 'ctc',
          existing: company.ctc, incoming: uniformCtc,
          context: { entity: 'company', company: company.name },
          sourceWins: config.source_wins,
        });
      }
    }

    const rowsByRoll = new Map();
    for (const row of source.rows) {
      if (!rowsByRoll.has(row.roll_number)) rowsByRoll.set(row.roll_number, []);
      rowsByRoll.get(row.roll_number).push(row);
    }

    for (const [rollNumber, placementRows] of rowsByRoll) {
      const sourceStudent = placementRows[0];
      let student = studentsByRoll.get(rollNumber);

      if (!student) {
        const { rows } = await client.query(
          `INSERT INTO students (
            roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend,
            registration_deadline, offer_date, batch_key, degree, graduation_year
          ) VALUES ($1, $2, $3, 'Placed', NULL, NULL, NULL, NULL, NULL, NULL, $4, $5, $6)
          RETURNING *`,
          [rollNumber, sourceStudent.name, sourceStudent.program || 'OTHER', config.batch_key, config.degree, config.graduation_year]
        );
        student = rows[0];
        studentsByRoll.set(rollNumber, student);
        report.created_students += 1;
      } else {
        student.name = await compareOrFill({
          client, report, table: 'students', id: student.id, field: 'name',
          existing: student.name, incoming: sourceStudent.name,
          context: { entity: 'student', roll_number: rollNumber },
          sourceWins: config.source_wins,
        });
        student.program = await compareOrFill({
          client, report, table: 'students', id: student.id, field: 'program',
          existing: student.program === 'OTHER' ? '' : student.program,
          incoming: sourceStudent.program,
          context: { entity: 'student', roll_number: rollNumber, student: sourceStudent.name },
          sourceWins: config.source_wins,
        });
        if (student.placement_status !== 'Placed') {
          addConflict(report, {
            entity: 'student',
            roll_number: rollNumber,
            student: sourceStudent.name,
            field: 'placement_status',
            existing: student.placement_status,
            incoming: 'Placed',
          }, config.source_wins ? 'applied new CSV value' : 'kept existing value');
          if (config.source_wins) {
            await client.query("UPDATE students SET placement_status = 'Placed' WHERE id = $1", [student.id]);
            report.updated_fields.placement_status = (report.updated_fields.placement_status || 0) + 1;
            student.placement_status = 'Placed';
          }
        }
      }

      const existingOffers = offersByStudent.get(String(student.id)) || [];
      const consumedOfferIds = new Set();
      for (const placement of placementRows) {
        const exactOffer = existingOffers.find((offer) => (
          !consumedOfferIds.has(String(offer.id))
          && normalizeKey(offer.company_name) === normalizeKey(placement.company)
        ));

        if (exactOffer) {
          consumedOfferIds.add(String(exactOffer.id));
          exactOffer.offer_type = await compareOrFill({
            client, report, table: 'offers', id: exactOffer.id, field: 'offer_type',
            existing: exactOffer.offer_type, incoming: placement.offer_type,
            context: { entity: 'offer', roll_number: rollNumber, student: sourceStudent.name, company: placement.company },
            sourceWins: config.source_wins,
          });
          exactOffer.ctc = await compareOrFill({
            client, report, table: 'offers', id: exactOffer.id, field: 'ctc',
            existing: exactOffer.ctc, incoming: placement.ctc,
            context: { entity: 'offer', roll_number: rollNumber, student: sourceStudent.name, company: placement.company },
            sourceWins: config.source_wins,
          });
          continue;
        }

        let company = companiesByKey.get(normalizeKey(placement.company));
        if (!company) {
          const { rows: insertedCompanies } = await client.query(
            `INSERT INTO companies (
              name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed,
              registration_deadline, offer_date, batch_key, degree, graduation_year
            ) VALUES ($1, 'Historical placement record', $2, $3, NULL, NULL, NULL, false, NULL, NULL, $4, $5, $6)
            RETURNING *`,
            [placement.company, placement.offer_type || null, placement.ctc, config.batch_key, config.degree, config.graduation_year]
          );
          company = insertedCompanies[0];
          companiesByKey.set(normalizeKey(company.name), company);
          report.created_companies += 1;
        }
        const { rows: insertedOffers } = await client.query(
          `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
           VALUES ($1, $2, $3, $4, NULL, NULL, NULL)
           RETURNING *`,
          [student.id, company.id, placement.offer_type || null, placement.ctc]
        );
        const inserted = { ...insertedOffers[0], company_name: company.name };
        existingOffers.push(inserted);
        offersByStudent.set(String(student.id), existingOffers);
        report.created_offers += 1;
      }

      const primaryOffer = existingOffers[0];
      if (primaryOffer) {
        await fillBlank({
          client, report, table: 'students', id: student.id, field: 'company_id',
          existing: student.company_id, incoming: primaryOffer.company_id,
        });
        await fillBlank({
          client, report, table: 'students', id: student.id, field: 'offer_type',
          existing: student.offer_type, incoming: primaryOffer.offer_type,
        });
        await fillBlank({
          client, report, table: 'students', id: student.id, field: 'ctc',
          existing: student.ctc, incoming: primaryOffer.ctc,
        });
      }
    }

    if (config.source_wins) {
      const deleted = await client.query(
        `DELETE FROM companies c
         WHERE c.batch_key = $1
           AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.company_id = c.id)
           AND NOT EXISTS (SELECT 1 FROM students s WHERE s.company_id = c.id)`,
        [config.batch_key]
      );
      report.deleted_orphan_companies = deleted.rowCount;
    }

    if (apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const client = new Client(buildClientConfig());
  await client.connect();

  try {
    const schema = fs.readFileSync(path.join(repoRoot, 'backend/sql/multi_batch_schema.sql'), 'utf8');
    await client.query(schema);
    const batches = [];

    for (const config of IMPORTS) {
      batches.push(await importBatch(client, config, readSource(config), apply));
    }

    const report = {
      generated_at: new Date().toISOString(),
      mode: apply ? 'applied' : 'dry-run',
      policy: 'B.Tech 2026 uses the new CSV when the same field or student-company offer conflicts, while preserving offers found in only one source. Other batches fill blanks and retain populated values.',
      batches,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      mode: report.mode,
      report: reportPath,
      batches: batches.map((batch) => ({
        batch_key: batch.batch_key,
        created_students: batch.created_students,
        created_companies: batch.created_companies,
        created_offers: batch.created_offers,
        replaced_offers: batch.replaced_offers,
        deleted_orphan_companies: batch.deleted_orphan_companies,
        filled_fields: batch.filled_fields,
        updated_fields: batch.updated_fields,
        preserved_earlier_only_offers: batch.preserved_earlier_only_offers.length,
        conflicts: batch.conflicts.length,
        ambiguous_rolls_skipped: batch.ambiguous_rolls_skipped.length,
        exact_duplicates_skipped: batch.exact_duplicates_skipped,
      })),
    }, null, 2));
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
