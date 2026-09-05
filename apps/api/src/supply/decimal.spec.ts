import { describe, expect, it } from 'vitest';
import { dec, formatDec, lineTotal, parseDec, sumMoney } from './decimal.js';

describe('decimal helpers', () => {
  it('round-trips decimal strings exactly', () => {
    for (const v of ['0', '1', '20', '19.9999', '200.5', '0.0001', '1234567.89']) {
      expect(formatDec(parseDec(v), v.includes('.') ? v.split('.')[1]!.length : 0)).toBe(v);
    }
  });

  it('rejects non-decimal input', () => {
    expect(() => parseDec('abc')).toThrow();
    expect(() => parseDec('1,000')).toThrow();
    expect(() => parseDec('')).toThrow();
  });

  it('adds and subtracts without float drift', () => {
    expect(formatDec(dec.add('0.1', '0.2'), 4)).toBe('0.3000');
    expect(formatDec(dec.sub('20', '19.9999'), 4)).toBe('0.0001');
    expect(formatDec(dec.add('1234567.89', '0.11'), 2)).toBe('1234568.00');
  });

  it('multiplies with correct scale', () => {
    expect(formatDec(dec.mul('3', '4.5'), 2)).toBe('13.50');
    expect(formatDec(dec.mul('100', '12.345'), 4)).toBe('1234.5000');
  });

  it('compares correctly', () => {
    expect(dec.gte('20', '20')).toBe(true);
    expect(dec.gt('20', '20')).toBe(false);
    expect(dec.lt('19.9999', '20')).toBe(true);
    expect(dec.cmp('5', '10')).toBe(-1);
    expect(dec.cmp('10', '5')).toBe(1);
    expect(dec.cmp('5', '5')).toBe(0);
    expect(dec.isZero('0.0000')).toBe(true);
    expect(dec.isNeg('-1')).toBe(true);
  });

  it('rounds half-up on format', () => {
    expect(formatDec(parseDec('1.005'), 2)).toBe('1.01');
    expect(formatDec(parseDec('1.004'), 2)).toBe('1.00');
    expect(formatDec(parseDec('2.5'), 0)).toBe('3');
  });

  it('computes a purchase-order line total: qty*price - discount + tax', () => {
    const t = lineTotal({
      quantity: '10',
      unitPrice: '250.00',
      discount: '100.00',
      taxRate: '0.18',
    });
    expect(t.net).toBe('2400.00');
    expect(t.tax).toBe('432.00');
    expect(t.total).toBe('2832.00');
  });

  it('sums money at 2dp', () => {
    expect(sumMoney(['2832.00', '1000.00', '0.01'])).toBe('3832.01');
    expect(sumMoney([])).toBe('0.00');
  });
});
