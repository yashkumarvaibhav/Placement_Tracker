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
    degree: 'M.Tech',
    graduation_year: 2024,
    academic_year: '2023-24',
    scope: 'CSE only',
    aggregate_only: true,
  },
  {
    key: 'mtech-cse-2023',
    label: 'M.Tech CSE 2022-23',
    degree: 'M.Tech',
    graduation_year: 2023,
    academic_year: '2022-23',
    scope: 'CSE only',
    aggregate_only: true,
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

export const getBranchPrograms = (branchGroup) => {
  if (branchGroup === 'CSE') return [...CSE_PROGRAMS];
  if (branchGroup === 'ECE') return [...ECE_PROGRAMS];
  if (branchGroup === 'CB') return [...CB_PROGRAMS];
  return [];
};

export const normalizeBatchPayload = (payload = {}) => {
  const batch = getBatchConfig(payload.batch_key || DEFAULT_BATCH_KEY);
  return {
    batch_key: batch.key,
    degree: payload.degree || batch.degree,
    graduation_year: payload.graduation_year || batch.graduation_year,
  };
};
