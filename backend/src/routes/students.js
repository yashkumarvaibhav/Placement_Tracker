import { Router } from 'express';
import { authMiddleware, requireViewerAuth } from '../auth.js';
import { resolveBatchKey, withResolvedBatch } from './helpers.js';
import {
  createStudent,
  deleteStudent,
  getCompany,
  getStudent,
  listStudents,
  listStudentsByCycle,
  updateStudent,
} from '../db.js';

const router = Router();

// A placed student's payload must reference real companies of their own placement cycle.
// Companies are cycle-scoped: any company of the student's graduation cycle may be attached,
// regardless of which degree batch stores the company row. Returns an error message or null.
const validatePlacedStudentOffers = async (payload) => {
  if (payload.placement_status !== 'Placed') return null;
  const offers = payload.offers || (payload.company_id ? [{ company_id: payload.company_id }] : []);
  if (!offers.length) return 'At least one company offer is required for placed students';
  for (const offer of offers) {
    const existsCompany = await getCompany(offer.company_id);
    if (!existsCompany) return `Company does not exist (id: ${offer.company_id})`;
    const companyYear = Number(existsCompany.graduation_year) || null;
    const studentYear = Number(payload.graduation_year) || null;
    if (companyYear && studentYear && companyYear !== studentYear) {
      return `Company ${offer.company_id} belongs to a different placement cycle`;
    }
  }
  return null;
};

router.get('/', requireViewerAuth, async (req, res) => {
  try {
    const data = req.query.cycle
      ? await listStudentsByCycle(Number(req.query.cycle))
      : await listStudents(resolveBatchKey(req.query.batch));
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', requireViewerAuth, async (req, res) => {
  try {
    const student = await getStudent(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    return res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const payload = withResolvedBatch(req);
    const validationError = await validatePlacedStudentOffers(payload);
    if (validationError) return res.status(400).json({ message: validationError });
    const created = await createStudent(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const exists = await getStudent(req.params.id);
    if (!exists) return res.status(404).json({ message: 'Student not found' });
    const payload = withResolvedBatch(req);
    const validationError = await validatePlacedStudentOffers(payload);
    if (validationError) return res.status(400).json({ message: validationError });
    const updated = await updateStudent(req.params.id, payload);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    await deleteStudent(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
