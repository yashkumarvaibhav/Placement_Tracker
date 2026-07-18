import { query } from './client.js';
import { DEFAULT_BATCH_KEY, getBatchConfig, normalizeBatchPayload } from '../batches.js';

export const listCompanies = async (batchKey = DEFAULT_BATCH_KEY) => {
  const resolvedBatch = getBatchConfig(batchKey);
  const { rows } = await query('SELECT * FROM companies WHERE batch_key = $1 ORDER BY name ASC', [resolvedBatch.key]);
  return rows;
};

// Companies are cycle-scoped: a cycle is a graduation year spanning both degrees.
export const listCompaniesByCycle = async (graduationYear) => {
  const { rows } = await query('SELECT * FROM companies WHERE graduation_year = $1 ORDER BY name ASC', [graduationYear]);
  return rows;
};

export const getCompany = async (id) => {
  const { rows } = await query('SELECT * FROM companies WHERE id = $1', [id]);
  return rows[0];
};

export const createCompany = async (payload) => {
  const batchData = normalizeBatchPayload(payload);
  const { rows } = await query(
    `INSERT INTO companies (name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed, registration_deadline, registration_open_date, offer_date, branches, roles, batch_key, degree, graduation_year)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
      payload.registration_open_date || null,
      payload.offer_date || null,
      Array.isArray(payload.branches) && payload.branches.length ? payload.branches : null,
      Array.isArray(payload.roles) && payload.roles.length ? JSON.stringify(payload.roles) : null,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
    ]
  );
  return rows[0];
};

export const updateCompany = async (id, payload) => {
  const batchData = normalizeBatchPayload(payload);
  const { rows } = await query(
    `UPDATE companies SET name=$1, role=$2, type=$3, ctc=$4, stipend=$5, category=$6, eligible_cgpa=$7, backlog_allowed=$8, registration_deadline=$9, registration_open_date=$10, offer_date=$11, branches=$12, roles=$13, batch_key=$14, degree=$15, graduation_year=$16
     WHERE id=$17 RETURNING *`,
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
      payload.registration_open_date || null,
      payload.offer_date || null,
      Array.isArray(payload.branches) && payload.branches.length ? payload.branches : null,
      Array.isArray(payload.roles) && payload.roles.length ? JSON.stringify(payload.roles) : null,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
      id,
    ]
  );
  return rows[0];
};

// Companies are referenced by offers and by students' denormalized primary-offer columns,
// neither with ON DELETE rules — deleting a referenced company violates the FK. Callers use
// this to refuse the delete with a clear message instead.
export const countCompanyReferences = async (id) => {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM offers WHERE company_id = $1) AS offer_count,
       (SELECT COUNT(*) FROM students WHERE company_id = $1) AS student_count`,
    [id]
  );
  return {
    offers: Number(rows[0]?.offer_count) || 0,
    students: Number(rows[0]?.student_count) || 0,
  };
};

export const deleteCompany = async (id) => {
  await query('DELETE FROM companies WHERE id=$1', [id]);
};
