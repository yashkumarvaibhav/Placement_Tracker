import { beforeEach, describe, expect, it, vi } from 'vitest';

// buildStats is exercised against in-memory rows: the data layer is stubbed so no database
// is touched.
const fixtures = vi.hoisted(() => ({ students: [], companies: [], offers: [] }));

vi.mock('../src/db/client.js', () => ({
  query: vi.fn(async () => ({ rows: fixtures.offers })),
}));

vi.mock('../src/db/companies.js', () => ({
  listCompanies: vi.fn(async () => fixtures.companies),
  listCompaniesByCycle: vi.fn(async () => fixtures.companies),
}));

vi.mock('../src/db/students.js', () => ({
  listStudents: vi.fn(async () => fixtures.students),
  listStudentsByCycle: vi.fn(async () => fixtures.students),
}));

const { buildStats } = await import('../src/db/stats.js');

const student = (id, name) => ({
  id,
  name,
  program: 'CSE',
  degree: 'B.Tech',
  placement_status: 'Placed',
});

const offer = (studentId, ctc, stipend = null) => ({
  student_id: studentId,
  company_id: 1,
  offer_type: 'FTE',
  ctc,
  stipend,
  company_category: 'A',
  company_ctc: null,
  company_stipend: null,
});

describe('compensation statistics', () => {
  beforeEach(() => {
    fixtures.companies = [{ id: 1, name: 'Acme' }];
    fixtures.students = [];
    fixtures.offers = [];
  });

  it('counts each student once, at their highest CTC', async () => {
    fixtures.students = [student(1, 'Multi offer'), student(2, 'Single offer')];
    // Student 1 holds two full-time offers; the lower one must not enter the mean or median.
    fixtures.offers = [offer(1, 3000000), offer(1, 1000000), offer(2, 2000000)];

    const stats = await buildStats('btech-2027');

    expect(stats.median_ctc).toBe(2500000);
    expect(stats.average_ctc).toBe(2500000);
    expect(stats.highest_ctc).toBe(3000000);
    // Offer counts stay per-offer: three offers were recorded across two students.
    expect(stats.total_offers).toBe(3);
  });

  it('applies the same one-value-per-student rule to stipends', async () => {
    fixtures.students = [student(1, 'Multi offer'), student(2, 'Single offer')];
    fixtures.offers = [offer(1, null, 100000), offer(1, null, 40000), offer(2, null, 60000)];

    const stats = await buildStats('btech-2027');

    expect(stats.median_stipend).toBe(80000);
    expect(stats.average_stipend).toBe(80000);
    expect(stats.highest_stipend).toBe(100000);
  });

  it('falls back to the company CTC when the offer has none', async () => {
    fixtures.students = [student(1, 'Company fallback')];
    fixtures.offers = [{ ...offer(1, null), company_ctc: 1800000 }];

    const stats = await buildStats('btech-2027');

    expect(stats.median_ctc).toBe(1800000);
  });

  it('leaves compensation null when no offer carries a value', async () => {
    fixtures.students = [student(1, 'No compensation')];
    fixtures.offers = [offer(1, null)];

    const stats = await buildStats('btech-2027');

    expect(stats.median_ctc).toBeNull();
    expect(stats.average_ctc).toBeNull();
    expect(stats.highest_ctc).toBeNull();
  });
});
