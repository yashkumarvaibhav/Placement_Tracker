import 'dotenv/config';
import pg from 'pg';
import { getBatchConfig } from '../src/batches.js';
import { isPlacementQualifyingOfferType } from '../src/offer-types.js';

// One-time migration for the placement-policy change:
//   winter "Intern" alone        -> Placed (unchanged)
//   "Summer Intern" alone        -> NOT placed
// Flips currently-Placed students whose every recorded offer is a non-qualifying summer
// internship to "Unplaced". Offers/internship records are preserved (they still feed the
// internship & stipend stats); only placement_status changes. Students holding a qualifying
// offer (FTE, PPO, winter Intern, or any summer-intern + FTE/PPO combo) are left untouched.
// Placed-records-only / aggregate archive batches are skipped (reported under skipped_archive).
//
// Dry-run by default; pass --apply to commit.

const { Client } = pg;

const buildClientConfig = () => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

const clean = (value) => String(value ?? '').trim();

const main = async () => {
  const apply = process.argv.includes('--apply');
  const client = new Client(buildClientConfig());
  await client.connect();

  const report = {
    mode: apply ? 'applied' : 'dry-run',
    placed_students_scanned: 0,
    summer_intern_only_students: 0,
    students_updated: 0,
    by_batch: {},
    affected: [],
    skipped_archive: [],
  };

  await client.query('BEGIN');
  try {
    const { rows: placedStudents } = await client.query(
      `SELECT id, roll_number, name, batch_key, offer_type
       FROM students
       WHERE placement_status = 'Placed'`
    );
    report.placed_students_scanned = placedStudents.length;

    const offersByStudent = new Map();
    if (placedStudents.length) {
      const { rows: offers } = await client.query(
        `SELECT student_id, offer_type
         FROM offers
         WHERE student_id = ANY($1::bigint[])`,
        [placedStudents.map((student) => student.id)]
      );
      for (const offer of offers) {
        if (!offersByStudent.has(offer.student_id)) offersByStudent.set(offer.student_id, []);
        offersByStudent.get(offer.student_id).push(offer.offer_type);
      }
    }

    const affectedIds = [];
    for (const student of placedStudents) {
      // Prefer the offers table; fall back to the student's primary offer_type column.
      const rawTypes = offersByStudent.get(student.id) ?? [student.offer_type];
      const types = rawTypes.map(clean).filter(Boolean);
      if (!types.length) continue; // No offer signal — leave ambiguous records alone.

      const summerInternOnly = types.every((type) => !isPlacementQualifyingOfferType(type));
      if (!summerInternOnly) continue;

      report.summer_intern_only_students += 1;

      const entry = {
        roll_number: student.roll_number,
        name: student.name,
        batch_key: student.batch_key,
        offer_types: types,
      };

      // Placed-records-only / aggregate archives have no "Unplaced" semantics (they don't even
      // display unplaced counts), so summer internships there are left as-is for a human to
      // decide rather than silently flipped into a contradictory state.
      const batch = getBatchConfig(student.batch_key);
      if (batch.placements_only || batch.aggregate_only) {
        report.skipped_archive.push(entry);
        continue;
      }

      report.by_batch[student.batch_key] = (report.by_batch[student.batch_key] || 0) + 1;
      report.affected.push(entry);
      affectedIds.push(student.id);
    }

    if (apply && affectedIds.length) {
      const { rowCount } = await client.query(
        `UPDATE students SET placement_status = 'Unplaced' WHERE id = ANY($1::bigint[])`,
        [affectedIds]
      );
      report.students_updated = rowCount;
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
