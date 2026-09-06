import { describe, expect, it } from 'vitest';
import { formatNumber } from './numbering.js';

describe('finance numbering — format', () => {
  it('pads to the configured width', () => {
    expect(formatNumber('INV-', 6, 1)).toBe('INV-000001');
    expect(formatNumber('INV-', 6, 42)).toBe('INV-000042');
    expect(formatNumber('PMT-', 6, 123456)).toBe('PMT-123456');
  });

  it('does not truncate when the value outgrows the padding', () => {
    expect(formatNumber('CN-', 4, 123456)).toBe('CN-123456');
  });

  it('works with a bigint value', () => {
    expect(formatNumber('INV-', 6, 7n)).toBe('INV-000007');
  });

  it('is a human string, never a UUID', () => {
    expect(formatNumber('INV-', 6, 1)).toMatch(/^INV-\d{6}$/);
  });
});
