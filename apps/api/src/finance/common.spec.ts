import { describe, expect, it } from 'vitest';
import { normaliseCurrency, resolveDefaultCurrency } from './common.js';

describe('normaliseCurrency', () => {
  it('accepts a real ISO-4217 code and uppercases it', () => {
    expect(normaliseCurrency('usd')).toBe('USD');
  });

  it('rejects a regex-shaped-but-fake currency code', () => {
    // 'ZZZ' matches the old `^[A-Z]{3}$` shape check but is not a real ISO-4217 code —
    // this is the exact behavior change normaliseCurrency's validation tightening makes.
    expect(() => normaliseCurrency('ZZZ')).toThrow();
  });

  it('falls back to INR when no value and no explicit fallback are given', () => {
    expect(normaliseCurrency(undefined)).toBe('INR');
  });

  it('falls back to a given fallback currency when no value is supplied', () => {
    expect(normaliseCurrency(undefined, 'EUR')).toBe('EUR');
  });
});

describe('resolveDefaultCurrency', () => {
  it("returns the tenant's configured default currency", async () => {
    const profiles = { loadProfile: async () => ({ defaultCurrency: 'EUR' }) } as never;
    expect(await resolveDefaultCurrency({} as never, 't1', profiles)).toBe('EUR');
  });

  it('falls back to INR for a tenant with no profile row', async () => {
    const profiles = { loadProfile: async () => null } as never;
    expect(await resolveDefaultCurrency({} as never, 't1', profiles)).toBe('INR');
  });

  it('falls back to INR for a tenant with a profile but no currency set', async () => {
    const profiles = { loadProfile: async () => ({ defaultCurrency: null }) } as never;
    expect(await resolveDefaultCurrency({} as never, 't1', profiles)).toBe('INR');
  });
});
