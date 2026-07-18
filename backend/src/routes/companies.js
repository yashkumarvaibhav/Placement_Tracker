import { Router } from 'express';
import { authMiddleware, requireViewerAuth } from '../auth.js';
import { resolveBatchKey, withResolvedBatch } from './helpers.js';
import {
  countCompanyReferences,
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  listCompaniesByCycle,
  updateCompany,
} from '../db.js';

const router = Router();

// All data routes require a signed-in viewer (or admin): the records are per-student
// placement outcomes, so the login wall must exist server-side, not just in the UI.
router.get('/', requireViewerAuth, async (req, res) => {
  try {
    const data = req.query.cycle
      ? await listCompaniesByCycle(Number(req.query.cycle))
      : await listCompanies(resolveBatchKey(req.query.batch));
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', requireViewerAuth, async (req, res) => {
  try {
    const company = await getCompany(req.params.id);
    if (!company) return res.status(404).json({ message: 'Company not found' });
    return res.json(company);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const created = await createCompany(withResolvedBatch(req));
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const exists = await getCompany(req.params.id);
    if (!exists) return res.status(404).json({ message: 'Company not found' });
    const updated = await updateCompany(req.params.id, withResolvedBatch(req));
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const refs = await countCompanyReferences(req.params.id);
    if (refs.offers || refs.students) {
      const parts = [
        refs.offers ? `${refs.offers} student offer${refs.offers === 1 ? '' : 's'}` : null,
        refs.students ? `${refs.students} student record${refs.students === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' and ');
      return res.status(409).json({ message: `Cannot delete this company: ${parts} still reference it. Remove those offers first.` });
    }
    await deleteCompany(req.params.id);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

export default router;
