export const DEFAULT_BATCH_KEY = 'mtech-2027';

export const BATCHES = [
  {
    key: 'mtech-2027',
    label: 'M.Tech 2027',
    degree: 'M.Tech',
    graduation_year: 2027,
  },
  {
    key: 'btech-2027',
    label: 'B.Tech 2027',
    degree: 'B.Tech',
    graduation_year: 2027,
  },
  {
    key: 'mtech-2026',
    label: 'M.Tech 2026',
    degree: 'M.Tech',
    graduation_year: 2026,
  },
  {
    key: 'btech-2026',
    label: 'B.Tech 2026',
    degree: 'B.Tech',
    graduation_year: 2026,
  },
  {
    key: 'mtech-2025',
    label: 'M.Tech 2025',
    degree: 'M.Tech',
    graduation_year: 2025,
    placements_only: true,
  },
  {
    key: 'btech-2025',
    label: 'B.Tech 2025',
    degree: 'B.Tech',
    graduation_year: 2025,
    placements_only: true,
  },
  {
    key: 'mtech-cse-2024',
    label: 'M.Tech CSE 2023-24',
    degree: 'M.Tech CSE',
    graduation_year: 2024,
    academic_year: '2023-24',
    scope: 'CSE only',
    aggregate_only: true,
  },
  {
    key: 'mtech-cse-2023',
    label: 'M.Tech CSE 2022-23',
    degree: 'M.Tech CSE',
    graduation_year: 2023,
    academic_year: '2022-23',
    scope: 'CSE only',
    aggregate_only: true,
  },
];

const CSE_PROGRAMS = new Set(['CSE', 'CSE-R', 'CSAI', 'CSAM', 'CSB', 'CSD', 'CSSS']);
const ECE_PROGRAMS = new Set(['ECE', 'EVE']);
const CB_PROGRAMS = new Set(['CB']);

export const PROGRAM_OPTIONS = [
  ...CSE_PROGRAMS,
  ...ECE_PROGRAMS,
  ...CB_PROGRAMS,
];

// A placement cycle = a graduation year spanning both degrees. `cycle-<year>` keys resolve to
// a synthetic "Overall" config so the cycle can flow through the same batch-keyed plumbing.
export const getCycleConfig = (graduationYear) => {
  const batches = BATCHES.filter((batch) => batch.graduation_year === Number(graduationYear));
  return {
    key: `cycle-${graduationYear}`,
    label: `${graduationYear} cycle`,
    degree: 'Overall',
    graduation_year: Number(graduationYear),
    placements_only: batches.length > 0 && batches.every((batch) => batch.placements_only),
    aggregate_only: batches.length > 0 && batches.every((batch) => batch.aggregate_only),
  };
};

export const getBatchConfig = (batchKey = DEFAULT_BATCH_KEY) => {
  if (typeof batchKey === 'string' && /^cycle-\d+$/.test(batchKey)) {
    return getCycleConfig(Number(batchKey.slice('cycle-'.length)));
  }
  return BATCHES.find((batch) => batch.key === batchKey) || BATCHES[0];
};

export const getBranchGroup = (programRaw = '') => {
  const normalized = String(programRaw || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (CSE_PROGRAMS.has(normalized)) return 'CSE';
  if (ECE_PROGRAMS.has(normalized)) return 'ECE';
  if (CB_PROGRAMS.has(normalized)) return 'CB';
  return 'OTHER';
};

export const METRIC_DEFINITIONS = {
  number_of_companies: 'Companies listed for the selected batch only. Because companies are batch-specific in this site, the same company can appear in multiple batches separately.',
  total_offers: 'All recorded offer rows for the selected batch. If one student has multiple offers, each offer is counted separately.',
  overall_placement_percentage: 'Placed students divided by the placement-eligible students in the selected batch. Students marked Not Sitting or Ineligible are excluded from this denominator.',
  total_students: 'Students currently present in this batch roster on the site. For the newly added batches, this comes from placement-registration rosters and may include students excluded from placement-rate denominators.',
  eligible_students: 'Students who are counted in placement tracking for the selected slice. Students marked Not Sitting or Ineligible are excluded from this count.',
  excluded_students: 'Students marked Not Sitting or Ineligible in the selected slice. They are shown for transparency but excluded from placement-rate and eligible-unplaced counts.',
  placed_students: 'Students marked as Placed in this batch. A student is considered placed by the site when their placement_status is set to Placed.',
  unplaced_students: 'Placement-eligible students in the selected slice who are still not placed. Students marked Not Sitting or Ineligible are not counted here.',
  total_intern_offers: 'Offer rows with an internship component, including summer internships and combined internship/PPO outcomes.',
  total_fte_offers: 'Offer rows with a full-time component, including PPO and combined internship/full-time outcomes.',
  total_combo_offers: 'Offer rows combining an internship, including summer internships, with an FTE or PPO outcome.',
  total_Aplus_offers: 'Offer rows whose linked company category is A+ in this site.',
  total_A_offers: 'Offer rows whose linked company category is A in this site.',
  total_B_offers: 'Offer rows whose linked company category is B in this site.',
  highest_ctc: 'Highest CTC among offers in this cohort. If an offer-specific CTC is missing, the site falls back to the linked company CTC.',
  average_ctc: 'Average of all available CTC values across offers in this cohort, using offer CTC first and company CTC as fallback.',
  median_ctc: 'Median of all available CTC values across offers in this cohort, using offer CTC first and company CTC as fallback.',
  highest_stipend: 'Highest stipend among offers in this cohort. If an offer-specific stipend is missing, the site falls back to the linked company stipend.',
  average_stipend: 'Average of all available stipend values across offers in this cohort, using offer stipend first and company stipend as fallback.',
  median_stipend: 'Median of all available stipend values across offers in this cohort, using offer stipend first and company stipend as fallback.',
  placement_percentage: 'Placed students divided by the placement-eligible students inside the currently shown branch slice. Students marked Not Sitting or Ineligible are excluded from this denominator.',
  internship_percentage: 'Offers with an internship component divided by total students in the currently shown slice. This is an offer-rate metric, not a unique-student metric.',
  fte_percentage: 'Offers with an FTE or PPO component divided by total students in the currently shown slice. This is an offer-rate metric, not a unique-student metric.',
};
