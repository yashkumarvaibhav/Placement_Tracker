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
    const companyId = await insertCompanyIfMissing(row.company);
    await run(
      `INSERT OR IGNORE INTO students (roll_number, name, program, placement_status, company_id, offer_type)
       VALUES (?, ?, ?, ?, ?, ?)` ,
      [row.roll, row.name, row.program, row.status, companyId, companyId ? 'FTE' : null]
    );
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

export const listStudents = () =>
  all(
    `SELECT s.*, c.name as company_name, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM students s
     LEFT JOIN companies c ON s.company_id = c.id
     ORDER BY s.roll_number ASC`
  );

export const getStudent = (id) =>
  get(
    `SELECT s.*, c.name as company_name, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM students s
     LEFT JOIN companies c ON s.company_id = c.id
     WHERE s.id = ?`,
    [id]
  );

export const createStudent = async (payload) => {
  const result = await run(
    `INSERT INTO students (roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      payload.company_id || null,
      payload.offer_type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.registration_deadline || null,
      payload.offer_date || null,
    ]
  );
  return getStudent(result.lastID);
};

export const updateStudent = async (id, payload) => {
  await run(
    `UPDATE students SET roll_number=?, name=?, program=?, placement_status=?, company_id=?, offer_type=?, ctc=?, stipend=?, registration_deadline=?, offer_date=?
     WHERE id=?`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      payload.company_id || null,
      payload.offer_type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.registration_deadline || null,
      payload.offer_date || null,
      id,
    ]
  );
  return getStudent(id);
};

export const deleteStudent = (id) => run('DELETE FROM students WHERE id=?', [id]);

export const buildStats = async () => {
  const companies = await listCompanies();
  const students = await listStudents();

  const offers = students.filter((s) => s.placement_status === 'Placed');
  const internOffers = offers.filter((s) => (s.offer_type || '').includes('Intern') && s.offer_type !== 'Intern+FTE');
  const fteOffers = offers.filter((s) => s.offer_type === 'FTE');
  const comboOffers = offers.filter((s) => s.offer_type === 'Intern+FTE');

  const byCategory = { Aplus: 0, A: 0, B: 0 };
  for (const s of offers) {
    const cat = s.company_category;
    if (!cat) continue;
    if (cat.toUpperCase() === 'A+') byCategory.Aplus += 1;
    else if (cat.toUpperCase() === 'A') byCategory.A += 1;
    else if (cat.toUpperCase() === 'B') byCategory.B += 1;
  }

  const ctcValues = offers
    .map((s) => s.ctc ?? s.company_ctc)
    .filter((v) => typeof v === 'number');
  const stipendValues = offers
    .map((s) => s.stipend ?? s.company_stipend)
    .filter((v) => typeof v === 'number');

  const median = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  const totalStudents = students.length || 1; // avoid divide by zero
  const fteCount = fteOffers.length + comboOffers.length;
  const internCount = internOffers.length + comboOffers.length;
  const placedCount = offers.length;

  return {
    number_of_companies: companies.length,
    total_offers: placedCount,
    total_intern_offers: internOffers.length,
    total_fte_offers: fteCount,
    total_combo_offers: comboOffers.length,
    total_Aplus_offers: byCategory.Aplus,
    total_A_offers: byCategory.A,
    total_B_offers: byCategory.B,
    highest_ctc: ctcValues.length ? Math.max(...ctcValues) : null,
    lowest_ctc: ctcValues.length ? Math.min(...ctcValues) : null,
    average_ctc: average(ctcValues),
    median_ctc: median(ctcValues),
    highest_stipend: stipendValues.length ? Math.max(...stipendValues) : null,
    lowest_stipend: stipendValues.length ? Math.min(...stipendValues) : null,
    average_stipend: average(stipendValues),
    median_stipend: median(stipendValues),
    fte_percentage: Number(((fteCount / totalStudents) * 100).toFixed(2)),
    internship_percentage: Number(((internCount / totalStudents) * 100).toFixed(2)),
    overall_placement_percentage: Number(((placedCount / totalStudents) * 100).toFixed(2)),
  };
};

export const adminToken = ADMIN_TOKEN;
export const closeDb = () => db.close();
