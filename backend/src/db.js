import { Pool } from 'pg';
import dns from 'dns/promises';

const ADMIN_TOKEN = 'admin-static-token';

// We will initialize this lazily to allow async DNS resolution
let pool = null;

const getPool = async () => {
  if (pool) return pool;

  const config = {
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    // Robustness Settings for Free Tier:
    connectionTimeoutMillis: 15000, // Wait 15s for new connection
    idleTimeoutMillis: 2000,        // Close idle connections after 2s (prevents stale connection errors)
    max: 2,                         // Limit pool size to avoid "Too many connections" errors
  };

  // If hostaddr is already manually set, use it. Otherwise, force resolve IPv4.
  if (process.env.PGHOSTADDR) {
    config.host = process.env.PGHOST;
    config.hostaddr = process.env.PGHOSTADDR;
    console.log('Using manual PGHOSTADDR:', config.hostaddr);
  } else {
    try {
      console.log(`Resolving DNS for ${process.env.PGHOST}...`);
      const addresses = await dns.resolve4(process.env.PGHOST);
      if (addresses && addresses.length > 0) {
        config.host = process.env.PGHOST; // Keep hostname for SSL verification
        config.hostaddr = addresses[0];   // Force connect to IPv4
        console.log(`Resolved ${process.env.PGHOST} to IPv4: ${config.hostaddr}`);
      } else {
        console.warn('No IPv4 addresses found, falling back to default hostname.');
        config.host = process.env.PGHOST;
      }
    } catch (err) {
      console.error('DNS Resolution failed:', err.message);
      config.host = process.env.PGHOST;
    }
  }

  pool = new Pool(config);

  // Log unexpected pool errors
  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    // Don't exit, just log it. The pool will discard the client.
  });

  return pool;
};

const query = async (text, params = []) => {
  let retries = 0;
  const maxRetries = 3;
  while (true) {
    try {
      const p = await getPool();
      const result = await p.query(text, params);
      return result;
    } catch (err) {
      if (retries < maxRetries) {
        retries++;
        console.error(`Query failed, retrying (${retries}/${maxRetries})...`, err.message);
        // If connection terminated, maybe we should slightly delay
        await new Promise(res => setTimeout(res, 1500));
      } else {
        throw err;
      }
    }
  }
};

const normalizeProgram = (programRaw = '') => {
  const normalized = programRaw.trim().toUpperCase();
  if (normalized.startsWith('CSE R')) return 'CSE-R';
  if (normalized.startsWith('CSE')) return 'CSE';
  if (normalized.startsWith('ECE')) return 'ECE';
  if (normalized.startsWith('CB')) return 'CB';
  return programRaw || 'CSE';
};

export const initDb = async () => {
  await query(`CREATE TABLE IF NOT EXISTS companies (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      type TEXT CHECK(type IN ('Intern','FTE','Intern+FTE')),
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      category TEXT,
      eligible_cgpa DOUBLE PRECISION,
      backlog_allowed BOOLEAN DEFAULT false,
      registration_deadline TEXT,
      offer_date TEXT
    );`);

  await query(`CREATE TABLE IF NOT EXISTS students (
      id BIGSERIAL PRIMARY KEY,
      roll_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      program TEXT NOT NULL,
      placement_status TEXT CHECK(placement_status IN ('Placed','Unplaced')) NOT NULL,
      company_id BIGINT REFERENCES companies(id),
      offer_type TEXT,
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      registration_deadline TEXT,
      offer_date TEXT
    );`);

  await query(`CREATE TABLE IF NOT EXISTS offers (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      company_id BIGINT NOT NULL REFERENCES companies(id),
      offer_type TEXT,
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      registration_deadline TEXT,
      offer_date TEXT
    );`);

  await query('CREATE INDEX IF NOT EXISTS idx_offers_student_id ON offers(student_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_offers_company_id ON offers(company_id);');
};

const backfillOffers = async () => {
  const { rows } = await query(
    `SELECT s.id as student_id, s.company_id, s.offer_type, s.ctc, s.stipend, s.registration_deadline, s.offer_date
     FROM students s
     WHERE s.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.student_id = s.id)`
  );

  for (const row of rows) {
    await query(
      `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.student_id,
        row.company_id,
        row.offer_type || null,
        row.ctc ?? null,
        row.stipend ?? null,
        row.registration_deadline || null,
        row.offer_date || null,
      ]
    );
  }
};

export const listCompanies = async () => {
  const { rows } = await query('SELECT * FROM companies ORDER BY name ASC');
  return rows;
};

export const getCompany = async (id) => {
  const { rows } = await query('SELECT * FROM companies WHERE id = $1', [id]);
  return rows[0];
};

export const createCompany = async (payload) => {
  const { rows } = await query(
    `INSERT INTO companies (name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed, registration_deadline, offer_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      payload.name,
      payload.role || '',
      payload.type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.category || null,
      payload.eligible_cgpa ?? null,
      payload.backlog_allowed ? true : false,
      payload.registration_deadline || null,
      payload.offer_date || null,
    ]
  );
  return rows[0];
};

export const updateCompany = async (id, payload) => {
  const { rows } = await query(
    `UPDATE companies SET name=$1, role=$2, type=$3, ctc=$4, stipend=$5, category=$6, eligible_cgpa=$7, backlog_allowed=$8, registration_deadline=$9, offer_date=$10
     WHERE id=$11 RETURNING *`,
    [
      payload.name,
      payload.role || '',
      payload.type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.category || null,
      payload.eligible_cgpa ?? null,
      payload.backlog_allowed ? true : false,
      payload.registration_deadline || null,
      payload.offer_date || null,
      id,
    ]
  );
  return rows[0];
};

export const deleteCompany = async (id) => {
  await query('DELETE FROM companies WHERE id=$1', [id]);
};

const fetchStudentWithCompanies = async (where = '', params = []) => {
  const { rows: students } = await query(
    `SELECT s.*, c.name as company_name, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM students s
     LEFT JOIN companies c ON s.company_id = c.id
     ${where}
     ORDER BY s.roll_number ASC`,
    params
  );

  const studentIds = students.map((s) => s.id);
  if (!studentIds.length) return students.map((s) => ({ ...s, offers: [] }));

  const { rows: offers } = await query(
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

  return students.map((s) => ({ ...s, offers: offersByStudent[s.id] || [] }));
};

export const listStudents = () => fetchStudentWithCompanies();

export const getStudent = async (id) => {
  const students = await fetchStudentWithCompanies('WHERE s.id = $1', [id]);
  return students[0];
};

const replaceOffers = async (studentId, offers = []) => {
  await query('DELETE FROM offers WHERE student_id = $1', [studentId]);
  for (const offer of offers) {
    if (!offer.company_id) continue;
    await query(
      `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        studentId,
        offer.company_id,
        offer.offer_type || null,
        offer.ctc ?? null,
        offer.stipend ?? null,
        offer.registration_deadline || null,
        offer.offer_date || null,
      ]
    );
  }
};

export const createStudent = async (payload) => {
  const isPlaced = payload.placement_status === 'Placed';
  const primaryCompany = isPlaced ? (payload.offers?.[0]?.company_id || payload.company_id || null) : null;
  const primaryOfferType = isPlaced ? (payload.offers?.[0]?.offer_type || payload.offer_type || null) : null;

  const { rows } = await query(
    `INSERT INTO students (roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      primaryCompany,
      primaryOfferType,
      isPlaced ? payload.ctc ?? null : null,
      isPlaced ? payload.stipend ?? null : null,
      isPlaced ? payload.registration_deadline || null : null,
      isPlaced ? payload.offer_date || null : null,
    ]
  );

  const studentId = rows[0]?.id;
  if (isPlaced && payload.offers?.length) await replaceOffers(studentId, payload.offers);
  return getStudent(studentId);
};

export const updateStudent = async (id, payload) => {
  const isPlaced = payload.placement_status === 'Placed';
  const primaryCompany = isPlaced ? (payload.offers?.[0]?.company_id || payload.company_id || null) : null;
  const primaryOfferType = isPlaced ? (payload.offers?.[0]?.offer_type || payload.offer_type || null) : null;

  await query(
    `UPDATE students SET roll_number=$1, name=$2, program=$3, placement_status=$4, company_id=$5, offer_type=$6, ctc=$7, stipend=$8, registration_deadline=$9, offer_date=$10
     WHERE id=$11`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      primaryCompany,
      primaryOfferType,
      isPlaced ? payload.ctc ?? null : null,
      isPlaced ? payload.stipend ?? null : null,
      isPlaced ? payload.registration_deadline || null : null,
      isPlaced ? payload.offer_date || null : null,
      id,
    ]
  );

  const offerPayload = isPlaced ? (payload.offers || []) : [];
  await replaceOffers(id, offerPayload);
  return getStudent(id);
};

export const deleteStudent = async (id) => {
  await query('DELETE FROM students WHERE id=$1', [id]);
};

export const buildStats = async () => {
  const companies = await listCompanies();
  const students = await listStudents();

  const { rows: offers } = await query(
    `SELECT o.*, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM offers o
     JOIN companies c ON o.company_id = c.id`
  );

  const internOffers = offers.filter((o) => (o.offer_type || '').includes('Intern') && o.offer_type !== 'Intern+FTE');
  const fteOffers = offers.filter((o) => o.offer_type === 'FTE');
  const comboOffers = offers.filter((o) => o.offer_type === 'Intern+FTE');

  const studentProgramMap = students.reduce((acc, s) => {
    acc[s.id] = s.program;
    return acc;
  }, {});

  const offersWithProgram = offers.map((o) => ({ ...o, program: studentProgramMap[o.student_id] }));

  const median = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  const toPct = (num, den) => (den ? Number(((num / den) * 100).toFixed(2)) : 0);

  const summarize = (subset, programs = null) => {
    const total = subset.length;
    const placed = subset.filter((s) => s.placement_status === 'Placed').length;
    const programSet = programs ? new Set(programs) : null;
    const offersSubset = programSet
      ? offersWithProgram.filter((o) => programSet.has(o.program))
      : offersWithProgram;

    const internSub = offersSubset.filter((o) => (o.offer_type || '').includes('Intern') && o.offer_type !== 'Intern+FTE');
    const fteSub = offersSubset.filter((o) => o.offer_type === 'FTE');
    const comboSub = offersSubset.filter((o) => o.offer_type === 'Intern+FTE');

    const byCategory = { Aplus: 0, A: 0, B: 0 };
    for (const o of offersSubset) {
      const cat = o.company_category;
      if (!cat) continue;
      if (cat.toUpperCase() === 'A+') byCategory.Aplus += 1;
      else if (cat.toUpperCase() === 'A') byCategory.A += 1;
      else if (cat.toUpperCase() === 'B') byCategory.B += 1;
    }

    const ctcValues = offersSubset
      .map((o) => o.ctc ?? o.company_ctc)
      .filter((v) => typeof v === 'number');
    const stipendValues = offersSubset
      .map((o) => o.stipend ?? o.company_stipend)
      .filter((v) => typeof v === 'number');

    const internCount = internSub.length + comboSub.length;
    const fteCount = fteSub.length + comboSub.length;

    return {
      total_students: total,
      placed_students: placed,
      total_offers: offersSubset.length,
      total_intern_offers: internSub.length,
      total_fte_offers: fteSub.length + comboSub.length,
      total_combo_offers: comboSub.length,
      total_Aplus_offers: byCategory.Aplus,
      total_A_offers: byCategory.A,
      total_B_offers: byCategory.B,
      highest_ctc: ctcValues.length ? Math.max(...ctcValues) : null,
      average_ctc: average(ctcValues),
      median_ctc: median(ctcValues),
      highest_stipend: stipendValues.length ? Math.max(...stipendValues) : null,
      average_stipend: average(stipendValues),
      median_stipend: median(stipendValues),
      placement_percentage: toPct(placed, total),
      internship_percentage: toPct(internCount, total),
      fte_percentage: toPct(fteCount, total),
    };
  };

  const totalStudents = students.length;
  const branchSummary = {
    overall: summarize(students),
    cse: summarize(students.filter((s) => s.program === 'CSE' || s.program === 'CSE-R'), ['CSE', 'CSE-R']),
    ece: summarize(students.filter((s) => s.program === 'ECE'), ['ECE']),
    cb: summarize(students.filter((s) => s.program === 'CB'), ['CB']),
  };

  const overall = branchSummary.overall;
  const placedCount = overall.placed_students;
  const fteCount = overall.total_fte_offers;
  const internCount = overall.total_intern_offers;

  return {
    number_of_companies: companies.length,
    total_offers: overall.total_offers,
    total_intern_offers: overall.total_intern_offers,
    total_fte_offers: overall.total_fte_offers,
    total_combo_offers: overall.total_combo_offers,
    total_Aplus_offers: overall.total_Aplus_offers,
    total_A_offers: overall.total_A_offers,
    total_B_offers: overall.total_B_offers,
    highest_ctc: overall.highest_ctc,
    lowest_ctc: null,
    average_ctc: overall.average_ctc,
    median_ctc: overall.median_ctc,
    highest_stipend: overall.highest_stipend,
    lowest_stipend: null,
    average_stipend: overall.average_stipend,
    median_stipend: overall.median_stipend,
    fte_percentage: toPct(fteCount, totalStudents),
    internship_percentage: toPct(internCount, totalStudents),
    overall_placement_percentage: toPct(placedCount, totalStudents),
    total_students: totalStudents,
    total_placed_students: placedCount,
    branch_summary: branchSummary,
  };
};

export const adminToken = ADMIN_TOKEN;
export const closeDb = async () => {
  if (pool) await pool.end();
};
export const ensureOfferBackfill = backfillOffers;
export const getTableCounts = async () => {
  const [companies, students, offers] = await Promise.all([
    query('SELECT count(*)::int AS count FROM companies'),
    query('SELECT count(*)::int AS count FROM students'),
    query('SELECT count(*)::int AS count FROM offers'),
  ]);

  return {
    companies: companies.rows[0]?.count ?? 0,
    students: students.rows[0]?.count ?? 0,
    offers: offers.rows[0]?.count ?? 0,
  };
};
