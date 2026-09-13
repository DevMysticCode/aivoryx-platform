import { describe, expect, it } from 'vitest';
import { assertPlanCatalogueConsistent, getPlan, isPlanKey, PLAN_DEFINITIONS } from './plans.js';
import { getSolution } from './solutions.js';

describe('plan catalogue', () => {
  it('every plan resolves to a real solution', () => {
    expect(() => assertPlanCatalogueConsistent()).not.toThrow();
    for (const p of PLAN_DEFINITIONS) {
      expect(() => getSolution(p.solutionKey)).not.toThrow();
    }
  });

  it('resolves a known plan key and rejects an unknown one', () => {
    expect(isPlanKey('AIVORYX_BUSINESS')).toBe(true);
    expect(isPlanKey('NOT_REAL')).toBe(false);
    expect(getPlan('AIVORYX_SOLAR').solutionKey).toBe('SOLAR_EPC');
    expect(() => getPlan('NOT_REAL' as never)).toThrow();
  });
});
