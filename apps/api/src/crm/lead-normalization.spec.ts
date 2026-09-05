import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePhone } from './lead-normalization.js';

describe('normalizePhone', () => {
  it('strips formatting punctuation', () => {
    expect(normalizePhone('(987) 654-3210')).toBe('9876543210');
  });

  it('preserves a leading + and strips the rest', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
  });

  it('rewrites a 00 international prefix to +', () => {
    expect(normalizePhone('0091 98765 43210')).toBe('+919876543210');
  });

  it('does not assume a default country code for a bare local number', () => {
    // "9876543210" and "+919876543210" are NOT the same normalized value —
    // no guessing. See ADR 0031.
    expect(normalizePhone('9876543210')).toBe('9876543210');
    expect(normalizePhone('9876543210')).not.toBe(normalizePhone('+919876543210'));
  });

  it('rejects too-short / empty / missing input', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Jane.DOE@Example.com  ')).toBe('jane.doe@example.com');
  });

  it('rejects empty / missing input', () => {
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});
