import { describe, expect, it } from 'vitest';
import {
  SOLUTION_DEFINITIONS,
  getSolution,
  isSolutionKey,
  validateModuleSet,
} from './solutions.js';

describe('solution catalogue', () => {
  it('every defined solution is a dependency-consistent module set', () => {
    for (const s of SOLUTION_DEFINITIONS) {
      const result = validateModuleSet(s.moduleKeys);
      expect(result.ok, `${s.key} should be dependency-consistent`).toBe(true);
    }
  });

  it('resolves a known solution key and rejects an unknown one', () => {
    expect(isSolutionKey('SOLAR_EPC')).toBe(true);
    expect(isSolutionKey('NOT_REAL')).toBe(false);
    expect(getSolution('BUSINESS').moduleKeys).toContain('CRM');
    expect(() => getSolution('NOT_REAL' as never)).toThrow();
  });

  it('validateModuleSet flags a candidate set missing a dependency', () => {
    // COMMERCIAL depends on CRM + SUPPLY — leaving SUPPLY out must fail.
    const result = validateModuleSet(['CRM', 'COMMERCIAL']);
    expect(result.ok).toBe(false);
    expect(result.unmet).toEqual([{ module: 'COMMERCIAL', missingDependencies: ['SUPPLY'] }]);
  });

  it('validateModuleSet accepts a dependency-satisfied candidate set', () => {
    expect(validateModuleSet(['CRM', 'SUPPLY', 'COMMERCIAL']).ok).toBe(true);
  });

  it('validateModuleSet accepts an empty set', () => {
    expect(validateModuleSet([]).ok).toBe(true);
  });
});
