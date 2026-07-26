import { Router } from 'express';
import {
  authMiddleware,
  requireRatingAuth,
  requireViewerAuth,
} from '../auth.js';
import {
  getMySkillRatings,
  getSkillRatingAnalytics,
  getStudent,
  saveSkillRating,
} from '../db.js';

const router = Router();
const RATING_FIELDS = ['overall', 'dsa', 'ml'];

const readRatings = (body = {}) => {
  const ratings = {};
  for (const field of RATING_FIELDS) {
    const value = Number(body[field]);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      return { error: `${field === 'dsa' ? 'DSA' : field === 'ml' ? 'ML' : 'Overall'} rating must be a whole number from 1 to 10.` };
    }
    ratings[field] = value;
  }
  return { ratings };
};

router.get('/mine', requireViewerAuth, requireRatingAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await getMySkillRatings(req.ratingEmail));
  } catch (err) {
    return next(err);
  }
});

// Attribution is intentionally available only through this admin endpoint. The viewer-facing
// student endpoints expose aggregate scores and counts, never individual rating rows.
router.get('/analytics', authMiddleware, async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await getSkillRatingAnalytics());
  } catch (err) {
    return next(err);
  }
});

router.put('/:studentId', requireViewerAuth, requireRatingAuth, async (req, res, next) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ message: 'A valid student is required.' });
    }

    const parsed = readRatings(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const student = await getStudent(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const result = await saveSkillRating(
      req.ratingEmail,
      studentId,
      parsed.ratings,
      { confirmUpdate: req.body?.confirm_update === true }
    );
    return res.status(result.created ? 201 : 200).json(result.rating);
  } catch (err) {
    if (err?.code === 'RATING_CONFIRMATION_REQUIRED') {
      return res.status(409).json({ message: err.message, confirmation_required: true });
    }
    return next(err);
  }
});

export default router;
