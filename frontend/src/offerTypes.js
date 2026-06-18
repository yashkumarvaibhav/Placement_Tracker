export const OFFER_TYPES = [
  'Intern',
  'FTE',
  'Intern+FTE',
  'Summer Intern + FTE',
  'Summer Intern + PPO',
  'Summer Intern',
  'Intern + PPO',
];

const normalizeType = (type) => String(type || '').toLowerCase().replace(/[^a-z]/g, '');

export const isInternshipOfferType = (type) => normalizeType(type).includes('intern');
export const isFullTimeOfferType = (type) => {
  const normalized = normalizeType(type);
  return normalized.includes('fte') || normalized.includes('ppo');
};
export const isCombinedOfferType = (type) => (
  isInternshipOfferType(type) && isFullTimeOfferType(type)
);

// Summer internships ("Summer Intern") are recorded outcomes but, per placement policy,
// do NOT make a student "placed" on their own. A plain winter "Intern" does.
export const isSummerInternOfferType = (type) => normalizeType(type).includes('summerintern');

// An offer that, by itself, qualifies a student as placed: any full-time/PPO outcome, or a
// winter internship. A summer-intern-only offer (no FTE/PPO) does not qualify.
export const isPlacementQualifyingOfferType = (type) => (
  isFullTimeOfferType(type) || (isInternshipOfferType(type) && !isSummerInternOfferType(type))
);
