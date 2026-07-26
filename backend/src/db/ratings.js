import { query, transaction } from './client.js';

export const getRatingViewerContext = async (email) => {
  const { rows } = await query(
    `SELECT sri.student_id AS id, s.name, s.roll_number, s.program, s.batch_key, s.degree, s.graduation_year
     FROM student_rating_identities sri
     JOIN students s ON s.id = sri.student_id
     WHERE sri.email = $1
     LIMIT 1`,
    [String(email || '').trim().toLowerCase()]
  );
  return rows[0] || null;
};

export const getMySkillRatings = async (raterEmail) => {
  const { rows } = await query(
    `SELECT sr.target_student_id, sr.overall, sr.dsa, sr.ml, sr.created_at, sr.updated_at,
            s.name AS target_name, s.roll_number AS target_roll_number, s.program AS target_program,
            s.batch_key AS target_batch_key
     FROM skill_ratings sr
     JOIN students s ON s.id = sr.target_student_id
     WHERE sr.rater_email = $1
     ORDER BY s.name ASC, s.roll_number ASC`,
    [String(raterEmail || '').trim().toLowerCase()]
  );
  return rows;
};

export const saveSkillRating = async (
  raterEmail,
  targetStudentId,
  { overall, dsa, ml },
  { confirmUpdate = false } = {}
) => transaction(async (client) => {
  const email = String(raterEmail || '').trim().toLowerCase();
  const inserted = await client.query(
    `INSERT INTO skill_ratings (rater_email, target_student_id, overall, dsa, ml)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (rater_email, target_student_id) DO NOTHING
     RETURNING target_student_id, overall, dsa, ml, created_at, updated_at`,
    [email, targetStudentId, overall, dsa, ml]
  );

  if (inserted.rowCount) return { created: true, rating: inserted.rows[0] };

  if (!confirmUpdate) {
    const error = new Error('Confirm before changing an existing rating.');
    error.code = 'RATING_CONFIRMATION_REQUIRED';
    throw error;
  }

  const { rows } = await client.query(
    `UPDATE skill_ratings
     SET overall = $1, dsa = $2, ml = $3, updated_at = NOW()
     WHERE rater_email = $4 AND target_student_id = $5
     RETURNING target_student_id, overall, dsa, ml, created_at, updated_at`,
    [overall, dsa, ml, email, targetStudentId]
  );
  return { created: false, rating: rows[0] };
});

export const getSkillRatingAnalytics = async () => {
  const [ratings, summary] = await Promise.all([
    query(
      `SELECT sr.id, sr.rater_email, sr.target_student_id, sr.overall, sr.dsa, sr.ml,
              sr.created_at, sr.updated_at,
              target.name AS target_name, target.roll_number AS target_roll_number,
              target.program AS target_program, target.batch_key AS target_batch_key,
              rater.name AS rater_name, rater.roll_number AS rater_roll_number,
              rater.program AS rater_program, rater.batch_key AS rater_batch_key
       FROM skill_ratings sr
       JOIN students target ON target.id = sr.target_student_id
       LEFT JOIN student_rating_identities sri ON sri.email = sr.rater_email
       LEFT JOIN students rater ON rater.id = sri.student_id
       ORDER BY sr.updated_at DESC, sr.id DESC`
    ),
    query(
      `SELECT COUNT(*)::int AS total_ratings,
              COUNT(DISTINCT rater_email)::int AS participating_raters,
              COUNT(DISTINCT target_student_id)::int AS students_rated
       FROM skill_ratings`
    ),
  ]);

  return {
    summary: summary.rows[0] || { total_ratings: 0, participating_raters: 0, students_rated: 0 },
    ratings: ratings.rows,
  };
};
