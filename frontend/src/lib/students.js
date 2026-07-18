import { getBranchGroup } from '../batches';
import {
  isCombinedOfferType,
  isFullTimeOfferType,
  isInternshipOfferType,
} from '../offerTypes';

const BRANCH_GROUP_ORDER = { CSE: 0, ECE: 1, CB: 2, OTHER: 3 };
const STUDENT_STATUS_OPTIONS = ['Placed', 'Unplaced', 'Ineligible', 'Not Sitting'];
const isPlacementEligibleStudent = (student) => !['not sitting', 'ineligible'].includes(
  String(student?.placement_status || '').trim().toLowerCase()
);

const DASHBOARD_BRANCH_LABELS = {
  ALL: 'All programs',
  CSE: 'CSE group',
  ECE: 'ECE group',
  CB: 'CB group',
  OTHER: 'Other programs',
};

const EMPTY_SLICE_SUMMARY = {
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

const sortPrograms = (programs) => [...programs].sort((left, right) => {
  const leftGroup = BRANCH_GROUP_ORDER[getBranchGroup(left)] ?? 99;
  const rightGroup = BRANCH_GROUP_ORDER[getBranchGroup(right)] ?? 99;
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;
  return left.localeCompare(right);
});

const getStudentOffers = (student) => {
  if (student.offers?.length) return student.offers;
  if (!student.company_id) return [];

  return [{
    offer_type: student.offer_type,
    ctc: student.ctc,
    stipend: student.stipend,
    company_category: student.company_category,
    company_ctc: student.company_ctc,
    company_stipend: student.company_stipend,
  }];
};

const buildProgramSummaries = (students, placementsOnly = false) => {
  if (!students.length) {
    return { branchGroups: [], branchSummaries: { ALL: EMPTY_SLICE_SUMMARY }, programSummaries: [] };
  }

  // In a mixed-degree set (the Overall/cycle view) programs are degree-qualified so that, e.g.,
  // B.Tech CSE and M.Tech CSE are distinct rows; single-degree views keep the bare program code.
  const mixedDegrees = new Set(students.map((student) => student.degree).filter(Boolean)).size > 1;
  const programLabel = (student) => (mixedDegrees && student.degree ? `${student.degree} ${student.program}` : student.program);

  const offersWithProgram = students.flatMap((student) => (
    getStudentOffers(student).map((offer) => ({ ...offer, program: student.program, programLabel: programLabel(student) }))
  ));

  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const toPct = (value, total) => (total ? Number(((value / total) * 100).toFixed(2)) : 0);

  const summarize = (subset, offerPredicate) => {
    const total = subset.length;
    const placed = subset.filter((student) => student.placement_status === 'Placed').length;
    const placementEligibleTotal = subset.filter(isPlacementEligibleStudent).length;
    const excludedStudents = Math.max(total - placementEligibleTotal, 0);
    const unplacedStudents = Math.max(placementEligibleTotal - placed, 0);
    const offersSubset = offersWithProgram.filter(offerPredicate);
    const comboOffers = offersSubset.filter((offer) => isCombinedOfferType(offer.offer_type));
    const internOffers = offersSubset.filter((offer) => isInternshipOfferType(offer.offer_type) && !isCombinedOfferType(offer.offer_type));
    const fteOffers = offersSubset.filter((offer) => isFullTimeOfferType(offer.offer_type) && !isCombinedOfferType(offer.offer_type));

    const categories = { Aplus: 0, A: 0, B: 0 };
    offersSubset.forEach((offer) => {
      const category = offer.company_category?.toUpperCase();
      if (category === 'A+') categories.Aplus += 1;
      else if (category === 'A') categories.A += 1;
      else if (category === 'B') categories.B += 1;
    });

    const ctcValues = offersSubset
      .map((offer) => offer.ctc ?? offer.company_ctc)
      .filter((value) => typeof value === 'number');
    const stipendValues = offersSubset
      .map((offer) => offer.stipend ?? offer.company_stipend)
      .filter((value) => typeof value === 'number');

    const internshipCount = internOffers.length + comboOffers.length;
    const fteCount = fteOffers.length + comboOffers.length;

    return {
      total_students: total,
      eligible_students: placementsOnly ? null : placementEligibleTotal,
      excluded_students: placementsOnly ? null : excludedStudents,
      placed_students: placed,
      unplaced_students: placementsOnly ? null : unplacedStudents,
      total_offers: offersSubset.length,
      total_intern_offers: internOffers.length,
      total_fte_offers: fteCount,
      total_combo_offers: comboOffers.length,
      total_Aplus_offers: categories.Aplus,
      total_A_offers: categories.A,
      total_B_offers: categories.B,
      highest_ctc: ctcValues.length ? Math.max(...ctcValues) : null,
      average_ctc: average(ctcValues),
      median_ctc: median(ctcValues),
      highest_stipend: stipendValues.length ? Math.max(...stipendValues) : null,
      average_stipend: average(stipendValues),
      median_stipend: median(stipendValues),
      placement_percentage: placementsOnly ? null : toPct(placed, placementEligibleTotal),
      internship_percentage: toPct(internshipCount, total),
      fte_percentage: toPct(fteCount, total),
    };
  };

  const programs = sortPrograms([...new Set(students.map((student) => student.program).filter(Boolean))]);
  const branchGroups = [...new Set(programs.map((program) => getBranchGroup(program)))].sort(
    (left, right) => (BRANCH_GROUP_ORDER[left] ?? 99) - (BRANCH_GROUP_ORDER[right] ?? 99)
  );
  const branchSummaries = branchGroups.reduce((accumulator, branchGroup) => ({
    ...accumulator,
    [branchGroup]: summarize(
      students.filter((student) => getBranchGroup(student.program) === branchGroup),
      (offer) => getBranchGroup(offer.program) === branchGroup
    ),
  }), {
    ALL: summarize(students, () => true),
  });

  const labelInfo = new Map();
  students.forEach((student) => {
    const label = programLabel(student);
    if (!labelInfo.has(label)) labelInfo.set(label, { program: student.program, degree: student.degree });
  });
  const programLabels = [...labelInfo.keys()].sort((left, right) => {
    const li = labelInfo.get(left);
    const ri = labelInfo.get(right);
    const lg = BRANCH_GROUP_ORDER[getBranchGroup(li.program)] ?? 99;
    const rg = BRANCH_GROUP_ORDER[getBranchGroup(ri.program)] ?? 99;
    if (lg !== rg) return lg - rg;
    if ((li.degree || '') !== (ri.degree || '')) return (li.degree || '').localeCompare(ri.degree || '');
    return li.program.localeCompare(ri.program);
  });

  return {
    branchGroups,
    branchSummaries,
    programSummaries: programLabels.map((label) => ({
      program: label,
      branchGroup: getBranchGroup(labelInfo.get(label).program),
      summary: summarize(
        students.filter((student) => programLabel(student) === label),
        (offer) => offer.programLabel === label
      ),
    })),
  };
};

export {
  BRANCH_GROUP_ORDER,
  STUDENT_STATUS_OPTIONS,
  isPlacementEligibleStudent,
  DASHBOARD_BRANCH_LABELS,
  EMPTY_SLICE_SUMMARY,
  sortPrograms,
  getStudentOffers,
  buildProgramSummaries,
};
