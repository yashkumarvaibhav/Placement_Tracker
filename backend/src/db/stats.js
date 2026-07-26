import { query } from './client.js';
import { DEFAULT_BATCH_KEY, getBatchConfig, getCycleConfig, getBranchGroup } from '../batches.js';
import { isCombinedOfferType, isFullTimeOfferType, isInternshipOfferType } from '../offer-types.js';
import { listCompanies, listCompaniesByCycle } from './companies.js';
import { listStudents, listStudentsByCycle } from './students.js';

export const buildStats = async (batchKey = DEFAULT_BATCH_KEY, graduationYear = null) => {
  const cycle = graduationYear !== null;
  const batch = cycle ? getCycleConfig(graduationYear) : getBatchConfig(batchKey);
  const companies = cycle ? await listCompaniesByCycle(graduationYear) : await listCompanies(batch.key);
  const students = cycle ? await listStudentsByCycle(graduationYear) : await listStudents(batch.key);

  if (batch.aggregate_only) {
    const totalOffers = companies.reduce((sum, company) => sum + (Number(company.reported_offer_count) || 0), 0);
    const companiesWithOffers = companies.filter((company) => Number(company.reported_offer_count) > 0).length;
    const aggregate = {
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      placed_students: 0,
      unplaced_students: 0,
      total_offers: totalOffers,
      total_intern_offers: 0,
      total_fte_offers: 0,
      total_combo_offers: 0,
      total_Aplus_offers: 0,
      total_A_offers: 0,
      total_B_offers: 0,
      highest_ctc: null,
      average_ctc: null,
      median_ctc: null,
      highest_stipend: null,
      average_stipend: null,
      median_stipend: null,
      placement_percentage: 0,
      internship_percentage: 0,
      fte_percentage: 0,
    };

    return {
      batch,
      aggregate_only: true,
      number_of_companies: companiesWithOffers,
      total_companies_listed: companies.length,
      total_offers: totalOffers,
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      unplaced_students: 0,
      total_placed_students: 0,
      available_programs: ['CSE'],
      branch_summary: { overall: aggregate, cse: aggregate, ece: { ...aggregate, total_offers: 0 }, cb: { ...aggregate, total_offers: 0 } },
    };
  }

  const studentIds = students.map((student) => student.id);
  if (!studentIds.length) {
    const empty = {
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      placed_students: 0,
      unplaced_students: 0,
      total_offers: 0,
      total_intern_offers: 0,
      total_fte_offers: 0,
      total_combo_offers: 0,
      total_Aplus_offers: 0,
      total_A_offers: 0,
      total_B_offers: 0,
      highest_ctc: null,
      average_ctc: null,
      median_ctc: null,
      highest_stipend: null,
      average_stipend: null,
      median_stipend: null,
      placement_percentage: 0,
      internship_percentage: 0,
      fte_percentage: 0,
    };
    return {
      batch,
      number_of_companies: companies.length,
      total_offers: 0,
      total_intern_offers: 0,
      total_fte_offers: 0,
      total_combo_offers: 0,
      total_Aplus_offers: 0,
      total_A_offers: 0,
      total_B_offers: 0,
      highest_ctc: null,
      lowest_ctc: null,
      average_ctc: null,
      median_ctc: null,
      highest_stipend: null,
      lowest_stipend: null,
      average_stipend: null,
      median_stipend: null,
      fte_percentage: 0,
      internship_percentage: 0,
      overall_placement_percentage: 0,
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      unplaced_students: 0,
      total_placed_students: 0,
      available_programs: [],
      branch_summary: { overall: empty, cse: empty, ece: empty, cb: empty },
    };
  }

  const { rows: offers } = await query(
    `SELECT o.*, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM offers o
     JOIN companies c ON o.company_id = c.id`
     + ` WHERE o.student_id = ANY($1::bigint[])`,
    [studentIds]
  );

  const studentProgramMap = students.reduce((acc, s) => {
    acc[s.id] = s.program;
    return acc;
  }, {});

  const offersWithProgram = offers.map((o) => ({ ...o, program: studentProgramMap[o.student_id] }));

  const median = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  // Compensation is a per-student statistic: a student with several offers is represented once,
  // by their best package, so a second (lower) offer cannot drag the mean or median down.
  const bestValuePerStudent = (offerRows, field, companyField) => {
    const best = new Map();
    for (const offer of offerRows) {
      const value = offer[field] ?? offer[companyField];
      if (typeof value !== 'number') continue;
      const current = best.get(offer.student_id);
      if (current === undefined || value > current) best.set(offer.student_id, value);
    }
    return [...best.values()];
  };

  const toPct = (num, den) => (den ? Number(((num / den) * 100).toFixed(2)) : 0);

  const isIncludedInPlacementRate = (student) => !['not sitting', 'ineligible'].includes(
    String(student?.placement_status || '').trim().toLowerCase()
  );

  const summarize = (subset, offerProgramFilter = null) => {
    const total = subset.length;
    const placed = subset.filter((s) => s.placement_status === 'Placed').length;
    const placementEligibleTotal = subset.filter(isIncludedInPlacementRate).length;
    const excludedStudents = Math.max(total - placementEligibleTotal, 0);
    const unplacedStudents = Math.max(placementEligibleTotal - placed, 0);
    const offersSubset = offerProgramFilter
      ? offersWithProgram.filter((o) => offerProgramFilter(o.program))
      : offersWithProgram;

    const comboSub = offersSubset.filter((o) => isCombinedOfferType(o.offer_type));
    const internSub = offersSubset.filter((o) => isInternshipOfferType(o.offer_type) && !isCombinedOfferType(o.offer_type));
    const fteSub = offersSubset.filter((o) => isFullTimeOfferType(o.offer_type) && !isCombinedOfferType(o.offer_type));

    const byCategory = { Aplus: 0, A: 0, B: 0 };
    for (const o of offersSubset) {
      const cat = o.company_category;
      if (!cat) continue;
      if (cat.toUpperCase() === 'A+') byCategory.Aplus += 1;
      else if (cat.toUpperCase() === 'A') byCategory.A += 1;
      else if (cat.toUpperCase() === 'B') byCategory.B += 1;
    }

    const ctcValues = bestValuePerStudent(offersSubset, 'ctc', 'company_ctc');
    const stipendValues = bestValuePerStudent(offersSubset, 'stipend', 'company_stipend');

    const internCount = internSub.length + comboSub.length;
    const fteCount = fteSub.length + comboSub.length;

    return {
      total_students: total,
      eligible_students: batch.placements_only ? null : placementEligibleTotal,
      excluded_students: batch.placements_only ? null : excludedStudents,
      placed_students: placed,
      unplaced_students: batch.placements_only ? null : unplacedStudents,
      total_offers: offersSubset.length,
      total_intern_offers: internSub.length,
      total_fte_offers: fteSub.length + comboSub.length,
      total_combo_offers: comboSub.length,
      total_Aplus_offers: byCategory.Aplus,
      total_A_offers: byCategory.A,
      total_B_offers: byCategory.B,
      highest_ctc: ctcValues.length ? Math.max(...ctcValues) : null,
      average_ctc: average(ctcValues),
      median_ctc: median(ctcValues),
      highest_stipend: stipendValues.length ? Math.max(...stipendValues) : null,
      average_stipend: average(stipendValues),
      median_stipend: median(stipendValues),
      placement_percentage: batch.placements_only ? null : toPct(placed, placementEligibleTotal),
      internship_percentage: toPct(internCount, total),
      fte_percentage: toPct(fteCount, total),
    };
  };

  const totalStudents = students.length;
  const placementEligibleStudents = students.filter(isIncludedInPlacementRate).length;
  const excludedStudents = Math.max(totalStudents - placementEligibleStudents, 0);
  const inBranch = (branchGroup) => (program) => getBranchGroup(program) === branchGroup;
  const branchSummary = {
    overall: summarize(students),
    cse: summarize(students.filter((s) => getBranchGroup(s.program) === 'CSE'), inBranch('CSE')),
    ece: summarize(students.filter((s) => getBranchGroup(s.program) === 'ECE'), inBranch('ECE')),
    cb: summarize(students.filter((s) => getBranchGroup(s.program) === 'CB'), inBranch('CB')),
  };

  const overall = branchSummary.overall;
  const placedCount = overall.placed_students;
  const unplacedCount = overall.unplaced_students;
  const fteCount = overall.total_fte_offers;
  const internCount = overall.total_intern_offers;
  const historicalReportedOffers = companies.reduce(
    (sum, company) => sum + (Number(company.reported_offer_count) || 0),
    0
  );
  const historicalRecruiters = companies.filter((company) => Number(company.reported_offer_count) > 0).length;

  return {
    batch,
    number_of_companies: companies.length,
    total_offers: overall.total_offers,
    total_intern_offers: overall.total_intern_offers,
    total_fte_offers: overall.total_fte_offers,
    total_combo_offers: overall.total_combo_offers,
    total_Aplus_offers: overall.total_Aplus_offers,
    total_A_offers: overall.total_A_offers,
    total_B_offers: overall.total_B_offers,
    highest_ctc: overall.highest_ctc,
    lowest_ctc: null,
    average_ctc: overall.average_ctc,
    median_ctc: overall.median_ctc,
    highest_stipend: overall.highest_stipend,
    lowest_stipend: null,
    average_stipend: overall.average_stipend,
    median_stipend: overall.median_stipend,
    fte_percentage: overall.fte_percentage,
    internship_percentage: overall.internship_percentage,
    overall_placement_percentage: batch.placements_only ? null : toPct(placedCount, placementEligibleStudents),
    total_students: totalStudents,
    eligible_students: batch.placements_only ? null : placementEligibleStudents,
    excluded_students: batch.placements_only ? null : excludedStudents,
    unplaced_students: batch.placements_only ? null : unplacedCount,
    total_placed_students: placedCount,
    historical_reported_offers: historicalReportedOffers,
    historical_recruiters: historicalRecruiters,
    available_programs: [...new Set(students.map((student) => student.program).filter(Boolean))].sort(),
    branch_summary: branchSummary,
  };
};
