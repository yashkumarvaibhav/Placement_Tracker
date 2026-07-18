import { describe, expect, it } from 'vitest';
import { BATCHES, getBatchConfig, getCycleConfig, normalizeBatchPayload, getBranchGroup } from '../src/batches.js';

describe('batch and cycle resolution', () => {
  it('resolves cycle-<year> keys to a synthetic Overall config', () => {
    const year = Math.max(...BATCHES.map((batch) => batch.graduation_year));
    const config = getBatchConfig(`cycle-${year}`);
    expect(config.degree).toBe('Overall');
    expect(config.graduation_year).toBe(year);
    expect(config.key).toBe(`cycle-${year}`);
  });

  it('falls back to the first batch for unknown keys', () => {
    expect(getBatchConfig('nonsense-key')).toBe(BATCHES[0]);
  });

  it('cycle config aggregates degree batches of that graduation year', () => {
    const year = Math.max(...BATCHES.map((batch) => batch.graduation_year));
    const cycle = getCycleConfig(year);
    expect(cycle.aggregate_only).toBe(false);
  });

  it('normalizeBatchPayload keeps explicit degree/graduation_year overrides', () => {
    const someBatch = BATCHES.find((batch) => !batch.aggregate_only);
    const normalized = normalizeBatchPayload({ batch_key: someBatch.key, degree: 'X', graduation_year: 1999 });
    expect(normalized).toEqual({ batch_key: someBatch.key, degree: 'X', graduation_year: 1999 });
  });

  it('maps programs to branch groups', () => {
    expect(getBranchGroup('CSAI')).toBe('CSE');
    expect(getBranchGroup('EVE')).toBe('ECE');
    expect(getBranchGroup('CB')).toBe('CB');
    expect(getBranchGroup('unknown')).toBe('OTHER');
  });
});
