import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { addOfferToStudent, convertOfferToPpo, getCompany, getStudent } from '../db.js';

const router = Router();

// Add a single offer to a student from a company's page. Offer type defaults to the
// company's type but may be overridden per student; compensation/date defaults fall back
// to the company's values when not provided.
router.post('/', authMiddleware, async (req, res) => {
  try {
    const studentId = req.body?.student_id;
    const companyId = req.body?.company_id;
    if (!studentId || !companyId) return res.status(400).json({ message: 'student_id and company_id are required' });
    const company = await getCompany(companyId);
    if (!company) return res.status(400).json({ message: 'Company not found' });
    const student = await getStudent(studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    const updated = await addOfferToStudent(studentId, {
      company_id: companyId,
      offer_type: req.body.offer_type || company.type || null,
      role: req.body.role || company.role || null,
      ctc: req.body.ctc ?? company.ctc ?? null,
      stipend: req.body.stipend ?? company.stipend ?? null,
      registration_deadline: req.body.registration_deadline || company.registration_deadline || null,
      offer_date: req.body.offer_date || company.offer_date || null,
    });
    res.status(201).json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Convert an internship-only offer (Intern / Summer Intern) into its "+ PPO" variant.
// The full-time CTC is required; role and PPO offer date are optional refinements.
router.post('/:id/convert-to-ppo', authMiddleware, async (req, res) => {
  try {
    const ctc = Number(req.body?.ctc);
    if (!Number.isFinite(ctc) || ctc <= 0) {
      return res.status(400).json({ message: 'A full-time CTC (₹ p.a.) is required to convert an offer to PPO' });
    }
    const updated = await convertOfferToPpo(req.params.id, {
      ctc,
      role: req.body?.role || null,
      offer_date: req.body?.offer_date || null,
    });
    res.json(updated);
  } catch (err) {
    res.status(err.message === 'Offer not found' ? 404 : 400).json({ message: err.message });
  }
});

export default router;
