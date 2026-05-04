export const DEFAULT_BATCH_KEY = 'mtech-2027';

export const BATCHES = [
  {
    key: 'mtech-2027',
    label: 'M.Tech 2027',
    degree: 'M.Tech',
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
    key: 'btech-2027',
    label: 'B.Tech 2027',
    degree: 'B.Tech',
    graduation_year: 2027,
  },
];

const CSE_PROGRAMS = new Set(['CSE', 'CSE-R', 'CSAI', 'CSAM', 'CSB', 'CSD', 'CSSS']);
const ECE_PROGRAMS = new Set(['ECE', 'EVE']);
const CB_PROGRAMS = new Set(['CB']);

export const getBatchConfig = (batchKey = DEFAULT_BATCH_KEY) => (
  BATCHES.find((batch) => batch.key === batchKey) || BATCHES[0]
);

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
  overall_placement_percentage: 'Placed students divided by total students in the selected batch, based on the placement_status stored in this site.',
  total_students: 'Students currently present in this batch roster on the site. For the newly added batches, this comes from placement-registration rosters.',
  placed_students: 'Students marked as Placed in this batch. A student is considered placed by the site when their placement_status is set to Placed.',
  total_intern_offers: 'Offer rows tagged as Intern only for the selected cohort.',
  total_fte_offers: 'Offer rows counted as full-time outcomes in this site. Intern+FTE rows are included here as well.',
  total_combo_offers: 'Offer rows tagged as Intern+FTE for the selected cohort.',
  total_Aplus_offers: 'Offer rows whose linked company category is A+ in this site.',
  total_A_offers: 'Offer rows whose linked company category is A in this site.',
  total_B_offers: 'Offer rows whose linked company category is B in this site.',
  highest_ctc: 'Highest CTC among offers in this cohort. If an offer-specific CTC is missing, the site falls back to the linked company CTC.',
  average_ctc: 'Average of all available CTC values across offers in this cohort, using offer CTC first and company CTC as fallback.',
  median_ctc: 'Median of all available CTC values across offers in this cohort, using offer CTC first and company CTC as fallback.',
  highest_stipend: 'Highest stipend among offers in this cohort. If an offer-specific stipend is missing, the site falls back to the linked company stipend.',
  average_stipend: 'Average of all available stipend values across offers in this cohort, using offer stipend first and company stipend as fallback.',
  median_stipend: 'Median of all available stipend values across offers in this cohort, using offer stipend first and company stipend as fallback.',
  placement_percentage: 'Placed students divided by total students inside the currently shown branch slice.',
  internship_percentage: 'Intern and Intern+FTE offer count divided by total students in the currently shown slice. This is an offer-rate metric in this site, not a unique-student metric.',
  fte_percentage: 'FTE and Intern+FTE offer count divided by total students in the currently shown slice. This is an offer-rate metric in this site, not a unique-student metric.',
};