import { describe, expect, it } from 'vitest';
import { formatMoney, formatDate, formatCalendarDate } from './format.js';

describe('formatMoney', () => {
  it('formats with two decimal places and no currency prefix when none is given', () => {
    expect(formatMoney('1234.5')).toBe('1,234.50');
  });

  it('prefixes the given currency code', () => {
    expect(formatMoney('1234.5', 'INR')).toBe('INR 1,234.50');
  });

  it('treats a missing value as zero', () => {
    expect(formatMoney(undefined)).toBe('0.00');
  });
});

describe('formatDate', () => {
  it('renders a different calendar day for the same instant under different timezones', () => {
    // 2026-01-01T02:00:00Z is still 2025-12-31 in a far-west timezone.
    const instant = '2026-01-01T02:00:00.000Z';
    expect(formatDate(instant, 'Pacific/Honolulu')).toBe('31 Dec 2025');
    expect(formatDate(instant, 'Asia/Kolkata')).toBe('01 Jan 2026');
  });

  it('defaults to UTC when no timezone is given', () => {
    expect(formatDate('2026-06-15T10:00:00.000Z')).toBe('15 Jun 2026');
  });

  it('returns an em dash for a missing value', () => {
    expect(formatDate(null)).toBe('—');
  });
});

describe('formatCalendarDate', () => {
  it('formats a plain date-only string by its literal components, never timezone-shifted', () => {
    // A "date" column has no time component — this must read the same regardless
    // of host timezone, unlike formatDate which parses it as a UTC instant.
    expect(formatCalendarDate('2026-01-15')).toBe('15 Jan 2026');
  });

  it('returns an em dash for a missing value', () => {
    expect(formatCalendarDate(null)).toBe('—');
  });
});
