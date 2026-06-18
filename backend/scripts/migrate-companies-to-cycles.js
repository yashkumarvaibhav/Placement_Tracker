import 'dotenv/config';
import pg from 'pg';
import { getBranchGroup } from '../src/batches.js';

// Supports the cycle-scoped company model:
//  - BACKFILL (safe, additive): for companies with no `branches` yet, derive degree-qualified
//    branch tags ("B.Tech:CSE", "M.Tech:ECE", ...) from the degrees/programs of the students
//    they have hired, so the per-degree dashboard keeps showing them and the branch field is
//    populated. Companies with no offers are left untouched (the UI falls back to their degree).
//  - MERGE (destructive, opt-in via --merge): collapses companies that are the same employer
//    entered once per degree within a cycle (same name + graduation year) into a single row:
//    keeper = lowest id, branches = union, keeper's empty fields filled from the dupes, then
//    offers.company_id and students.company_id are re-pointed to the keeper and the dupes
//    deleted. Take a DB backup first.
//
// Dry-run by default; pass --apply to write. --merge enables the dedupe (still needs --apply
// to commit). Always back up before running --merge --apply.

const { Client } = pg;

const buildClientConfig = () => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const COMPANY_COLUMNS = [
  'id', 'name', 'role', 'type', 'ctc', 'stipend', 'category', 'eligible_cgpa',
  'backlog_allowed', 'registration_deadline', 'registration_open_date', 'offer_date',
  'reported_offer_count', 'degree', 'graduation_year', 'branches',
];
const FILL_FIELDS = [
  'role', 'type', 'ctc', 'stipend', 'category', 'eligible_cgpa',
  'registration_deadline', 'registration_open_date', 'offer_date', 'reported_offer_count',
];
const firstNonNull = (rows, field) => {
  for (const row of rows) {
    const value = row[field];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
};

const main = async () => {
  const apply = process.argv.includes('--apply');
  const merge = process.argv.includes('--merge');
  const client = new Client(buildClientConfig());
  await client.connect();

  const report = {
    mode: apply ? 'applied' : 'dry-run',
    merge_requested: merge,
    companies_total: 0,
    branches_backfilled: 0,
    backfill_samples: [],
    duplicate_group_count: 0,
    groups_merged: 0,
    companies_deleted: 0,
    offers_repointed: 0,
    students_repointed: 0,
    merge_samples: [],
  };

  await client.query('BEGIN');
  try {
    const { rows: companies } = await client.query(
      `SELECT ${COMPANY_COLUMNS.join(', ')} FROM companies ORDER BY graduation_year DESC, name ASC`
    );
    report.companies_total = companies.length;

    const { rows: offerRows } = await client.query(
      'SELECT o.company_id, s.degree, s.program FROM offers o JOIN students s ON s.id = o.student_id'
    );
    const derivedByCompany = new Map();
    for (const row of offerRows) {
      if (!row.company_id) continue;
      const token = `${row.degree || ''}:${getBranchGroup(row.program)}`;
      if (token.startsWith(':') || token.endsWith(':')) continue;
      if (!derivedByCompany.has(String(row.company_id))) derivedByCompany.set(String(row.company_id), new Set());
      derivedByCompany.get(String(row.company_id)).add(token);
    }

    // Backfill plan: companies with no branches yet but with derivable ones from offers.
    const backfillUpdates = [];
    for (const company of companies) {
      const hasBranches = Array.isArray(company.branches) && company.branches.length > 0;
      if (hasBranches) continue;
      const derived = [...(derivedByCompany.get(String(company.id)) || [])].sort();
      if (!derived.length) continue;
      backfillUpdates.push({ id: company.id, branches: derived });
      if (report.backfill_samples.length < 10) {
        report.backfill_samples.push({ id: company.id, name: company.name, branches: derived });
      }
    }
    report.branches_backfilled = backfillUpdates.length;

    // Group by cycle + normalized name; >1 row in a group = the same employer split by degree.
    const groups = new Map();
    for (const company of companies) {
      const key = `${company.graduation_year}|${normalize(company.name)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(company);
    }

    const mergePlan = [];
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) => Number(a.id) - Number(b.id));
      const keeper = sorted[0];
      const dupes = sorted.slice(1);
      // Union of all members' branches, augmented with any freshly-derived tags so the keeper
      // is visible in every degree the group recruited.
      const branchSet = new Set();
      for (const member of sorted) {
        (Array.isArray(member.branches) ? member.branches : []).forEach((t) => branchSet.add(t));
        (derivedByCompany.get(String(member.id)) || new Set()).forEach((t) => branchSet.add(t));
      }
      const fill = {};
      for (const field of FILL_FIELDS) fill[field] = firstNonNull(dupes, field);
      mergePlan.push({
        keeperId: keeper.id,
        dupeIds: dupes.map((d) => d.id),
        name: keeper.name,
        cycle: keeper.graduation_year,
        branches: [...branchSet].sort(),
        fill,
      });
    }
    report.duplicate_group_count = mergePlan.length;

    const allDupeIds = mergePlan.flatMap((g) => g.dupeIds);
    if (allDupeIds.length) {
      const o = await client.query('SELECT count(*)::int n FROM offers WHERE company_id = ANY($1::bigint[])', [allDupeIds]);
      const s = await client.query('SELECT count(*)::int n FROM students WHERE company_id = ANY($1::bigint[])', [allDupeIds]);
      report.offers_repointed = o.rows[0].n;
      report.students_repointed = s.rows[0].n;
    }
    report.companies_deleted = allDupeIds.length;
    report.merge_samples = mergePlan.slice(0, 8).map((g) => ({ name: g.name, cycle: g.cycle, keeper: g.keeperId, dupes: g.dupeIds, branches: g.branches }));

    if (apply) {
      for (const update of backfillUpdates) {
        await client.query('UPDATE companies SET branches = $1 WHERE id = $2', [update.branches, update.id]);
      }
      if (merge) {
        for (const g of mergePlan) {
          await client.query('UPDATE offers SET company_id = $1 WHERE company_id = ANY($2::bigint[])', [g.keeperId, g.dupeIds]);
          await client.query('UPDATE students SET company_id = $1 WHERE company_id = ANY($2::bigint[])', [g.keeperId, g.dupeIds]);
          await client.query(
            `UPDATE companies SET
               branches = $1,
               role = COALESCE(role, $2),
               type = COALESCE(type, $3),
               ctc = COALESCE(ctc, $4),
               stipend = COALESCE(stipend, $5),
               category = COALESCE(category, $6),
               eligible_cgpa = COALESCE(eligible_cgpa, $7),
               registration_deadline = COALESCE(registration_deadline, $8),
               registration_open_date = COALESCE(registration_open_date, $9),
               offer_date = COALESCE(offer_date, $10),
               reported_offer_count = COALESCE(reported_offer_count, $11)
             WHERE id = $12`,
            [
              g.branches.length ? g.branches : null,
              g.fill.role, g.fill.type, g.fill.ctc, g.fill.stipend, g.fill.category, g.fill.eligible_cgpa,
              g.fill.registration_deadline, g.fill.registration_open_date, g.fill.offer_date, g.fill.reported_offer_count,
              g.keeperId,
            ]
          );
          await client.query('DELETE FROM companies WHERE id = ANY($1::bigint[])', [g.dupeIds]);
        }
        report.groups_merged = mergePlan.length;
      }
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
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
