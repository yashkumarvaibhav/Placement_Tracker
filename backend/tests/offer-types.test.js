import { describe, expect, it } from 'vitest';
import {
  OFFER_TYPES,
  isCombinedOfferType,
  isFullTimeOfferType,
  isInternshipOfferType,
  isPlacementQualifyingOfferType,
  isSummerInternOfferType,
} from '../src/offer-types.js';

describe('offer type policy', () => {
  it('classifies every known offer type consistently', () => {
    const matrix = Object.fromEntries(OFFER_TYPES.map((type) => [type, {
      internship: isInternshipOfferType(type),
      fullTime: isFullTimeOfferType(type),
      combined: isCombinedOfferType(type),
      summer: isSummerInternOfferType(type),
      qualifies: isPlacementQualifyingOfferType(type),
    }]));

    expect(matrix).toEqual({
      'Intern': { internship: true, fullTime: false, combined: false, summer: false, qualifies: true },
      'FTE': { internship: false, fullTime: true, combined: false, summer: false, qualifies: true },
      'Intern+FTE': { internship: true, fullTime: true, combined: true, summer: false, qualifies: true },
      'Summer Intern + FTE': { internship: true, fullTime: true, combined: true, summer: true, qualifies: true },
      'Summer Intern + PPO': { internship: true, fullTime: true, combined: true, summer: true, qualifies: true },
      'Summer Intern': { internship: true, fullTime: false, combined: false, summer: true, qualifies: false },
      'Intern + PPO': { internship: true, fullTime: true, combined: true, summer: false, qualifies: true },
    });
  });

  it('a summer internship alone never qualifies a student as placed', () => {
    expect(isPlacementQualifyingOfferType('Summer Intern')).toBe(false);
    expect(isPlacementQualifyingOfferType('summer intern')).toBe(false);
  });

  it('handles null/unknown types without qualifying them', () => {
    expect(isPlacementQualifyingOfferType(null)).toBe(false);
    expect(isPlacementQualifyingOfferType('')).toBe(false);
    expect(isInternshipOfferType(undefined)).toBe(false);
  });
});
