import { query } from './client.js';

// The institute mail pattern for a student is <first name><last 5 digits of roll>@iiitd.ac.in.
// Roster spreadsheets sometimes list a surname first ("Shaik Abdul Khadeer" -> abdul25086@),
// so the derived pattern alone misses a handful of people. The imported roster address in
// student_rating_identities covers those, and both sides are anchored to a real 2027 student
// row, so accepting either one cannot let in an outsider.
const ROSTER_EMAIL_MATCH = `
  s.graduation_year = $2
  AND s.placement_status NOT IN ('Not Sitting', 'Ineligible')
  AND (
    regexp_replace(lower(split_part(btrim(s.name), ' ', 1)), '[^a-z]', '', 'g')
      || right(regexp_replace(s.roll_number, '\\D', '', 'g'), 5)
      || '@iiitd.ac.in' = $1
    OR EXISTS (
      SELECT 1 FROM student_rating_identities sri
      WHERE sri.student_id = s.id AND sri.email = $1
    )
  )`;

// Which graduating batch is currently sitting in the placement process. Auto-approval follows
// this cohort; everyone else on the institute domain goes through the admin request queue.
export const PLACEMENT_ROSTER_YEAR = 2027;

export const findPlacementRosterStudent = async (email) => {
  const { rows } = await query(
    `SELECT s.id, s.name, s.roll_number, s.batch_key
     FROM students s
     WHERE ${ROSTER_EMAIL_MATCH}
     LIMIT 1`,
    [String(email || '').trim().toLowerCase(), PLACEMENT_ROSTER_YEAR],
  );
  return rows[0] || null;
};

export const getAccessRequest = async (email) => {
  const { rows } = await query(
    'SELECT * FROM access_requests WHERE email = $1 LIMIT 1',
    [String(email || '').trim().toLowerCase()],
  );
  return rows[0] || null;
};

// Repeat sign-in attempts refresh the queue entry instead of piling up rows, so the admin sees
// one line per person with a count of how often they have knocked.
export const recordAccessRequest = async ({ email, name }) => {
  const { rows } = await query(
    `INSERT INTO access_requests (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
     SET last_attempt_at = NOW(),
         attempts = access_requests.attempts + 1,
         name = COALESCE(NULLIF(EXCLUDED.name, ''), access_requests.name)
     RETURNING *`,
    [String(email || '').trim().toLowerCase(), String(name || '').trim() || null],
  );
  return rows[0];
};

export const listAccessRequests = async () => {
  const { rows } = await query(
    `SELECT * FROM access_requests
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
              last_attempt_at DESC`,
  );
  return rows;
};

export const setAccessRequestStatus = async (id, status, decidedBy) => {
  const { rows } = await query(
    `UPDATE access_requests
     SET status = $2, decided_at = NOW(), decided_by = $3
     WHERE id = $1
     RETURNING *`,
    [id, status, String(decidedBy || '').trim().toLowerCase() || null],
  );
  return rows[0] || null;
};
