import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { parse } from 'csv-parse';

const DB_PATH = path.join(process.cwd(), 'data.sqlite');
const ADMIN_TOKEN = 'admin-static-token';

sqlite3.verbose();
const db = new sqlite3.Database(DB_PATH);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function exec(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const normalizeProgram = (programRaw = '') => {
  const normalized = programRaw.trim().toUpperCase();
  if (normalized.startsWith('CSE R')) return 'CSE-R';
  if (normalized.startsWith('CSE')) return 'CSE';
  if (normalized.startsWith('ECE')) return 'ECE';
  if (normalized.startsWith('CB')) return 'CB';
  return programRaw || 'CSE';
};

export const initDb = async () => {
  await run(`CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      type TEXT CHECK(type IN ('Intern','FTE','Intern+FTE')),
      ctc REAL,
      stipend REAL,
      category TEXT,
      eligible_cgpa REAL,
      backlog_allowed INTEGER DEFAULT 0,
      registration_deadline TEXT,
      offer_date TEXT
    );`);

  await run(`CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roll_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      program TEXT NOT NULL,
      placement_status TEXT CHECK(placement_status IN ('Placed','Unplaced')) NOT NULL,
      company_id INTEGER,
      offer_type TEXT,
      ctc REAL,
      stipend REAL,
      registration_deadline TEXT,
      offer_date TEXT,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );`);

  await run(`CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      offer_type TEXT,
      ctc REAL,
      stipend REAL,
      registration_deadline TEXT,
      offer_date TEXT,
      FOREIGN KEY(student_id) REFERENCES students(id),
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );`);
};

const backfillOffers = async () => {
  const rows = await all(
    `SELECT s.id as student_id, s.company_id, s.offer_type, s.ctc, s.stipend, s.registration_deadline, s.offer_date
     FROM students s
     WHERE s.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.student_id = s.id)`
  );

  for (const row of rows) {
    await run(
      `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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

const parseCsvRow = (row) => {
  const roll = row[1]?.trim();
  const name = row[2]?.trim();
  const program = normalizeProgram(row[3] || '');
  const statusRaw = (row[4] || '').toUpperCase();
  const status = statusRaw.includes('PLACED') ? 'Placed' : 'Unplaced';
  const company = row[5]?.trim() || '';

  if (!roll || roll === 'Roll No.' || !name) return null;
  if (!/MT\d+/.test(roll)) return null;

  return { roll, name, program, status, company };
};

const insertCompanyIfMissing = async (name) => {
  if (!name || name.toUpperCase() === 'UNPLACED') return null;
  const existing = await get('SELECT id FROM companies WHERE lower(name)=lower(?)', [name]);
  if (existing) return existing.id;
  const result = await run(
    'INSERT INTO companies (name, role, type, ctc, stipend, category) VALUES (?, ?, ?, ?, ?, ?)',
    [name, '', 'FTE', null, null, null]
  );
  return result.lastID;
};

export const seedFromCsv = async (csvPath) => {
  const studentCount = await get('SELECT COUNT(1) as count FROM students');
  if (studentCount?.count > 0) return; // avoid duplicate seed

  const parser = fs
    .createReadStream(csvPath)
    .pipe(parse({ relax_quotes: true }));

  const rows = [];
  for await (const record of parser) {
    const parsed = parseCsvRow(record);
    if (parsed) rows.push(parsed);
  }

  for (const row of rows) {
    const companyNames = row.company
      ? row.company
          .split(/[,/]| and /i)
          .map((c) => c.trim())
          .filter(Boolean)
      : [];

    const offerCompanyIds = [];
    for (const name of companyNames) {
      const cid = await insertCompanyIfMissing(name);
      if (cid) offerCompanyIds.push(cid);
    }

    const primaryCompanyId = offerCompanyIds[0] || null;

    const studentResult = await run(
      `INSERT OR IGNORE INTO students (roll_number, name, program, placement_status, company_id, offer_type)
       VALUES (?, ?, ?, ?, ?, ?)` ,
      [row.roll, row.name, row.program, row.status, primaryCompanyId, primaryCompanyId ? 'FTE' : null]
    );

    const studentId = studentResult.lastID;
    if (studentId && offerCompanyIds.length) {
      for (const cid of offerCompanyIds) {
        await run(
          `INSERT INTO offers (student_id, company_id, offer_type) VALUES (?, ?, ?)`,
          [studentId, cid, 'FTE']
        );
      }
    }
  }
};

export const listCompanies = () => all('SELECT * FROM companies ORDER BY name ASC');
export const getCompany = (id) => get('SELECT * FROM companies WHERE id = ?', [id]);
export const createCompany = async (payload) => {
  const result = await run(
    `INSERT INTO companies (name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed, registration_deadline, offer_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.name,
      payload.role || '',
      payload.type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.category || null,
      payload.eligible_cgpa ?? null,
      payload.backlog_allowed ? 1 : 0,
      payload.registration_deadline || null,
      payload.offer_date || null,
    ]
  );
  return getCompany(result.lastID);
};

export const updateCompany = async (id, payload) => {
  await run(
    `UPDATE companies SET name=?, role=?, type=?, ctc=?, stipend=?, category=?, eligible_cgpa=?, backlog_allowed=?, registration_deadline=?, offer_date=? WHERE id=?`,
    [
      payload.name,
      payload.role || '',
      payload.type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.category || null,
      payload.eligible_cgpa ?? null,
      payload.backlog_allowed ? 1 : 0,
      payload.registration_deadline || null,
      payload.offer_date || null,
      id,
    ]
  );
  return getCompany(id);
};

export const deleteCompany = (id) => run('DELETE FROM companies WHERE id=?', [id]);

const fetchStudentWithCompanies = async (where = '', params = []) => {
  const students = await all(
    `SELECT s.*, c.name as company_name, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM students s
     LEFT JOIN companies c ON s.company_id = c.id
     ${where}
     ORDER BY s.roll_number ASC`,
    params
  );

  const studentIds = students.map((s) => s.id);
  if (!studentIds.length) return students.map((s) => ({ ...s, offers: [] }));

  const offers = await all(
    `SELECT o.*, co.name as company_name, co.category as company_category, co.type as company_type, co.ctc as company_ctc, co.stipend as company_stipend
     FROM offers o
     JOIN companies co ON o.company_id = co.id
     WHERE o.student_id IN (${studentIds.map(() => '?').join(',')})`,
    studentIds
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
  const students = await fetchStudentWithCompanies('WHERE s.id = ?', [id]);
  return students[0];
};

const replaceOffers = async (studentId, offers = []) => {
  await run('DELETE FROM offers WHERE student_id = ?', [studentId]);
  for (const offer of offers) {
    if (!offer.company_id) continue;
    await run(
      `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
  const result = await run(
    `INSERT INTO students (roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ,
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

  const studentId = result.lastID;
  if (isPlaced && payload.offers?.length) await replaceOffers(studentId, payload.offers);
  return getStudent(studentId);
};

export const updateStudent = async (id, payload) => {
  const isPlaced = payload.placement_status === 'Placed';
  const primaryCompany = isPlaced ? (payload.offers?.[0]?.company_id || payload.company_id || null) : null;
  const primaryOfferType = isPlaced ? (payload.offers?.[0]?.offer_type || payload.offer_type || null) : null;
  await run(
    `UPDATE students SET roll_number=?, name=?, program=?, placement_status=?, company_id=?, offer_type=?, ctc=?, stipend=?, registration_deadline=?, offer_date=?
     WHERE id=?`,
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
export const deleteStudent = (id) => run('DELETE FROM students WHERE id=?', [id]);

export const buildStats = async () => {
  const companies = await listCompanies();
  const students = await listStudents();

  const offers = await all(
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
export const closeDb = () => db.close();
export const ensureOfferBackfill = backfillOffers;