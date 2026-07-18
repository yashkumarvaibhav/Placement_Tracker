import { query, transaction, runOn } from './client.js';
import { DEFAULT_BATCH_KEY, getBatchConfig, getBranchGroup, normalizeBatchPayload } from '../batches.js';
import {
  isFullTimeOfferType,
  isInternshipOfferType,
  isPlacementQualifyingOfferType,
  isSummerInternOfferType,
} from '../offer-types.js';

const normalizeProgram = (programRaw = '') => {
  const normalized = programRaw.trim().toUpperCase();
  if (normalized.startsWith('CSE R')) return 'CSE-R';
  if (normalized.startsWith('CSE')) return 'CSE';
  if (normalized.startsWith('ECE')) return 'ECE';
  if (normalized.startsWith('CB')) return 'CB';
  return programRaw || 'CSE';
};

const fetchStudentWithCompanies = async ({ studentId = null, batchKey = DEFAULT_BATCH_KEY, graduationYear = null, client = null } = {}) => {
  const run = runOn(client);
  const params = [];
  const whereParts = [];

  if (graduationYear !== null) {
    // Cycle scope: all students of a graduation year, across both degrees.
    params.push(graduationYear);
    whereParts.push(`s.graduation_year = $${params.length}`);
  } else if (batchKey) {
    params.push(getBatchConfig(batchKey).key);
    whereParts.push(`s.batch_key = $${params.length}`);
  }

  if (studentId !== null) {
    params.push(studentId);
    whereParts.push(`s.id = $${params.length}`);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const { rows: students } = await run(
    `SELECT s.*, c.name as company_name, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM students s
     LEFT JOIN companies c ON s.company_id = c.id
     ${whereClause}
     ORDER BY s.roll_number ASC`,
    params
  );

  const studentIds = students.map((s) => s.id);
  if (!studentIds.length) {
    return students.map((s) => ({ ...s, offers: [], branch_group: getBranchGroup(s.program) }));
  }

  const { rows: offers } = await run(
    `SELECT o.*, co.name as company_name, co.category as company_category, co.type as company_type, co.ctc as company_ctc, co.stipend as company_stipend
     FROM offers o
     JOIN companies co ON o.company_id = co.id
     WHERE o.student_id = ANY($1::bigint[])`,
    [studentIds]
  );

  const offersByStudent = offers.reduce((acc, offer) => {
    acc[offer.student_id] = acc[offer.student_id] || [];
    acc[offer.student_id].push(offer);
    return acc;
  }, {});

  return students.map((s) => ({ ...s, offers: offersByStudent[s.id] || [], branch_group: getBranchGroup(s.program) }));
};

export const listStudents = (batchKey = DEFAULT_BATCH_KEY) => fetchStudentWithCompanies({ batchKey });

export const listStudentsByCycle = (graduationYear) => fetchStudentWithCompanies({ graduationYear, batchKey: null });

export const getStudent = async (id, client = null) => {
  const students = await fetchStudentWithCompanies({ studentId: id, batchKey: null, client });
  return students[0];
};

// Diff-based sync of a student's offers: rows for companies that stay keep their ids (other
// features hold offer ids across edits, e.g. the PPO conversion), removed companies are
// deleted, new ones inserted. Incoming offers are deduped per company to match the schema's
// unique (student_id, company_id) rule.
const replaceOffers = async (studentId, offers = [], client = null) => {
  const run = runOn(client);
  const incoming = [];
  const seen = new Set();
  for (const offer of offers) {
    if (!offer.company_id || seen.has(String(offer.company_id))) continue;
    seen.add(String(offer.company_id));
    incoming.push(offer);
  }

  const { rows: existing } = await run('SELECT id, company_id FROM offers WHERE student_id = $1', [studentId]);
  const existingByCompany = new Map(existing.map((row) => [String(row.company_id), row.id]));

  for (const offer of incoming) {
    const fields = [
      offer.offer_type || null,
      offer.role || null,
      offer.ctc ?? null,
      offer.stipend ?? null,
      offer.registration_deadline || null,
      offer.offer_date || null,
    ];
    const existingId = existingByCompany.get(String(offer.company_id));
    if (existingId) {
      await run(
        'UPDATE offers SET offer_type=$1, role=$2, ctc=$3, stipend=$4, registration_deadline=$5, offer_date=$6 WHERE id=$7',
        [...fields, existingId]
      );
    } else {
      await run(
        `INSERT INTO offers (student_id, company_id, offer_type, role, ctc, stipend, registration_deadline, offer_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [studentId, offer.company_id, ...fields]
      );
    }
  }

  const removedIds = existing.filter((row) => !seen.has(String(row.company_id))).map((row) => row.id);
  if (removedIds.length) {
    await run('DELETE FROM offers WHERE id = ANY($1::bigint[])', [removedIds]);
  }
};

// Offers are decoupled from placement_status: a placed student keeps all offers, while a
// non-placed student keeps only non-qualifying offers (e.g. a summer internship) as recorded
// outcomes. Because the admin form doesn't manage offers for non-placed students, an
// offer-less payload must not erase a stored summer internship — fall back to the student's
// existing non-qualifying offers in that case.
const resolveStudentOffers = async (id, payload, isPlaced, client = null) => {
  if (isPlaced) return payload.offers || [];
  const incoming = (payload.offers || []).filter(
    (offer) => !isPlacementQualifyingOfferType(offer.offer_type)
  );
  if (incoming.length) return incoming;
  if (id == null) return [];
  const existing = await getStudent(id, client);
  return (existing?.offers || []).filter(
    (offer) => !isPlacementQualifyingOfferType(offer.offer_type)
  );
};

// Resolves the offers to persist plus the denormalized "primary offer" columns on the student
// row. For placed students these mirror the form's primary fields (unchanged); for non-placed
// students they mirror a retained non-qualifying offer, if any.
const buildStudentWrite = async (id, payload, client = null) => {
  const isPlaced = payload.placement_status === 'Placed';
  const offers = await resolveStudentOffers(id, payload, isPlaced, client);
  const primary = offers[0] || null;
  return {
    offers,
    company_id: isPlaced ? (payload.offers?.[0]?.company_id || payload.company_id || null) : (primary?.company_id || null),
    offer_type: isPlaced ? (payload.offers?.[0]?.offer_type || payload.offer_type || null) : (primary?.offer_type || null),
    ctc: isPlaced ? (payload.ctc ?? null) : (primary?.ctc ?? null),
    stipend: isPlaced ? (payload.stipend ?? null) : (primary?.stipend ?? null),
    registration_deadline: isPlaced ? (payload.registration_deadline || null) : (primary?.registration_deadline || null),
    offer_date: isPlaced ? (payload.offer_date || null) : (primary?.offer_date || null),
  };
};

export const createStudent = async (payload) => transaction(async (client) => {
  const write = await buildStudentWrite(null, payload, client);
  const batchData = normalizeBatchPayload(payload);

  const { rows } = await client.query(
    `INSERT INTO students (roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend, registration_deadline, offer_date, batch_key, degree, graduation_year)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      write.company_id,
      write.offer_type,
      write.ctc,
      write.stipend,
      write.registration_deadline,
      write.offer_date,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
    ]
  );

  const studentId = rows[0]?.id;
  await replaceOffers(studentId, write.offers, client);
  return getStudent(studentId, client);
});

export const updateStudent = async (id, payload) => transaction(async (client) => {
  const write = await buildStudentWrite(id, payload, client);
  const batchData = normalizeBatchPayload(payload);

  await client.query(
    `UPDATE students SET roll_number=$1, name=$2, program=$3, placement_status=$4, company_id=$5, offer_type=$6, ctc=$7, stipend=$8, registration_deadline=$9, offer_date=$10, batch_key=$11, degree=$12, graduation_year=$13
     WHERE id=$14`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      write.company_id,
      write.offer_type,
      write.ctc,
      write.stipend,
      write.registration_deadline,
      write.offer_date,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
      id,
    ]
  );

  await replaceOffers(id, write.offers, client);
  return getStudent(id, client);
});

// Attaches a single offer (e.g. added from a company's page) to a student and reconciles
// placement_status per policy: a qualifying offer (FTE/PPO/winter Intern) marks the student
// Placed; a summer-intern-only offer leaves their status unchanged. Never downgrades.
export const addOfferToStudent = async (studentId, offer) => transaction(async (client) => {
  const existing = await client.query(
    'SELECT 1 FROM offers WHERE student_id = $1 AND company_id = $2 LIMIT 1',
    [studentId, offer.company_id]
  );
  if (existing.rows.length) throw new Error('This student already has an offer from this company');

  await client.query(
    `INSERT INTO offers (student_id, company_id, offer_type, role, ctc, stipend, registration_deadline, offer_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      studentId,
      offer.company_id,
      offer.offer_type || null,
      offer.role || null,
      offer.ctc ?? null,
      offer.stipend ?? null,
      offer.registration_deadline || null,
      offer.offer_date || null,
    ]
  );

  const refreshed = await getStudent(studentId, client);
  const offers = refreshed?.offers || [];
  const qualifying = offers.find((o) => isPlacementQualifyingOfferType(o.offer_type));
  if (qualifying && refreshed.placement_status !== 'Placed') {
    await client.query(
      `UPDATE students SET placement_status='Placed', company_id=$1, offer_type=$2, ctc=$3, stipend=$4, registration_deadline=$5, offer_date=$6 WHERE id=$7`,
      [qualifying.company_id, qualifying.offer_type, qualifying.ctc ?? null, qualifying.stipend ?? null, qualifying.registration_deadline || null, qualifying.offer_date || null, studentId]
    );
  } else if (!refreshed.company_id && offers.length) {
    const primary = offers[0];
    await client.query(
      `UPDATE students SET company_id=$1, offer_type=$2, ctc=$3, stipend=$4 WHERE id=$5`,
      [primary.company_id, primary.offer_type, primary.ctc ?? null, primary.stipend ?? null, studentId]
    );
  }
  return getStudent(studentId, client);
});

// Converts an internship-only offer (Intern / Summer Intern) into its "+ PPO" variant with
// the full-time package details. A PPO is a qualifying outcome, so a not-yet-placed student
// becomes Placed with this offer as their primary; for an already-placed student the
// denormalized primary-offer columns are refreshed only when this offer is the primary.
export const convertOfferToPpo = async (offerId, { ctc, role, offer_date } = {}) => transaction(async (client) => {
  const { rows } = await client.query('SELECT * FROM offers WHERE id = $1', [offerId]);
  const offer = rows[0];
  if (!offer) throw new Error('Offer not found');
  if (!isInternshipOfferType(offer.offer_type) || isFullTimeOfferType(offer.offer_type)) {
    throw new Error('Only Intern or Summer Intern offers can be converted to PPO');
  }

  const newType = isSummerInternOfferType(offer.offer_type) ? 'Summer Intern + PPO' : 'Intern + PPO';
  await client.query(
    'UPDATE offers SET offer_type=$1, ctc=$2, role=COALESCE($3, role), offer_date=COALESCE($4, offer_date) WHERE id=$5',
    [newType, ctc ?? null, role || null, offer_date || null, offerId]
  );

  const refreshed = await getStudent(offer.student_id, client);
  const converted = (refreshed?.offers || []).find((o) => String(o.id) === String(offerId));
  if (converted) {
    if (refreshed.placement_status !== 'Placed') {
      await client.query(
        `UPDATE students SET placement_status='Placed', company_id=$1, offer_type=$2, ctc=$3, stipend=$4, registration_deadline=$5, offer_date=$6 WHERE id=$7`,
        [converted.company_id, converted.offer_type, converted.ctc ?? null, converted.stipend ?? null, converted.registration_deadline || null, converted.offer_date || null, offer.student_id]
      );
    } else if (String(refreshed.company_id || '') === String(converted.company_id)) {
      await client.query(
        'UPDATE students SET offer_type=$1, ctc=$2, stipend=$3, offer_date=$4 WHERE id=$5',
        [converted.offer_type, converted.ctc ?? null, converted.stipend ?? null, converted.offer_date || null, offer.student_id]
      );
    }
  }
  return getStudent(offer.student_id, client);
});

export const deleteStudent = async (id) => {
  await query('DELETE FROM students WHERE id=$1', [id]);
};
