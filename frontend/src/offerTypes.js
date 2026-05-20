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
