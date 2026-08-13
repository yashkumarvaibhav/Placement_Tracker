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

  it('reports the lowest CTC/stipend alongside the highest, one value per student', async () => {
    fixtures.students = [student(1, 'Multi offer'), student(2, 'Single offer')];
    fixtures.offers = [offer(1, 3000000, 100000), offer(1, 1000000, 40000), offer(2, 2000000, 60000)];

    const stats = await buildStats('btech-2027');

    // Student 1's floor offer (1,000,000 / 40,000) must not surface here either: the site
    // still represents each student once, at their own best package.
    expect(stats.lowest_ctc).toBe(2000000);
    expect(stats.lowest_stipend).toBe(60000);
  });

  // 0 is the "known unknown" sentinel (e.g. a PPO recorded before its CTC was confirmed): it
  // must be excluded from every compensation figure exactly like a missing value, not treated
  // as a real ₹0 package that drags the average and median down.
  it('excludes a 0 CTC/stipend (known-unknown sentinel) from compensation statistics', async () => {
    fixtures.students = [student(1, 'Unknown PPO'), student(2, 'Confirmed offer')];
    fixtures.offers = [
      { ...offer(1, 0), offer_type: 'Intern + PPO' },
      offer(2, 2000000, 0),
    ];

    const stats = await buildStats('btech-2027');

    expect(stats.median_ctc).toBe(2000000);
    expect(stats.average_ctc).toBe(2000000);
    expect(stats.highest_ctc).toBe(2000000);
    expect(stats.median_stipend).toBeNull();
    expect(stats.average_stipend).toBeNull();
    expect(stats.highest_stipend).toBeNull();
  });
});

describe('offer-type counts', () => {
  beforeEach(() => {
    fixtures.companies = [{ id: 1, name: 'Acme' }];
    fixtures.students = [];
    fixtures.offers = [];
  });

  it('counts combined internship+FTE/PPO offers as both an internship and an FTE outcome', async () => {
    fixtures.students = [student(1, 'Combo'), student(2, 'Intern only'), student(3, 'FTE only')];
    fixtures.offers = [
      { ...offer(1, 1500000), offer_type: 'Intern + PPO' },
      { ...offer(2, null), offer_type: 'Intern' },
      { ...offer(3, 1200000), offer_type: 'FTE' },
    ];

    const stats = await buildStats('btech-2027');

    // total_intern_offers is documented (frontend METRIC_DEFINITIONS) as including combined
    // outcomes, and must agree with internship_percentage's own count of the same offers.
    expect(stats.total_intern_offers).toBe(2);
    expect(stats.total_fte_offers).toBe(2);
    expect(stats.total_combo_offers).toBe(1);
    expect(stats.internship_percentage).toBe(toPctFixture(2, 3));
  });

  it('excludes Not Sitting/Ineligible students from the internship/FTE offer-rate denominator, like placement_percentage', async () => {
    fixtures.students = [
      student(1, 'FTE offer'),
      { ...student(2, 'Not sitting'), placement_status: 'Not Sitting' },
    ];
    fixtures.offers = [offer(1, 1200000)];

    const stats = await buildStats('btech-2027');

    // 1 FTE offer over 1 placement-eligible student (the "Not Sitting" student is excluded from
    // the denominator, the same way they're excluded from overall_placement_percentage) — not over 2.
    expect(stats.fte_percentage).toBe(toPctFixture(1, 1));
    expect(stats.overall_placement_percentage).toBe(toPctFixture(1, 1));
  });
});

function toPctFixture(num, den) {
  return Number(((num / den) * 100).toFixed(2));
}
