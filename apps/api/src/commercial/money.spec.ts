import { describe, expect, it } from 'vitest';
import { lineAmounts, quoteTotals } from './money.js';

describe('quotation money math', () => {
  it('computes a plain line with no discount or tax', () => {
    expect(lineAmounts({ quantity: '3', unitPrice: '100', discount: '0', taxRate: '0' })).toEqual({
      lineNet: '300.00',
      lineTax: '0.00',
      lineTotal: '300.00',
    });
  });

  it('applies discount before tax', () => {
    // (10 * 250) - 500 = 2000 net; tax 18% = 360; total 2360
    expect(
      lineAmounts({ quantity: '10', unitPrice: '250', discount: '500', taxRate: '0.18' }),
    ).toEqual({ lineNet: '2000.00', lineTax: '360.00', lineTotal: '2360.00' });
  });

  it('never lets a discount drive the net negative', () => {
    expect(
      lineAmounts({ quantity: '1', unitPrice: '100', discount: '250', taxRate: '0.18' }),
    ).toEqual({ lineNet: '0.00', lineTax: '0.00', lineTotal: '0.00' });
  });

  it('handles fractional quantities and prices with half-up rounding', () => {
    // 2.5 * 19.99 = 49.975 -> 49.98 net; tax 5% = 2.4988 -> 2.50; total 52.48
    expect(
      lineAmounts({ quantity: '2.5', unitPrice: '19.99', discount: '0', taxRate: '0.05' }),
    ).toEqual({ lineNet: '49.98', lineTax: '2.50', lineTotal: '52.48' });
  });

  it('rolls lines up into quotation totals (subtotal is pre-discount gross)', () => {
    const totals = quoteTotals([
      { quantity: '10', unitPrice: '250', discount: '500', taxRate: '0.18' }, // gross 2500
      { quantity: '2', unitPrice: '1000', discount: '0', taxRate: '0.18' }, // gross 2000
      { quantity: '4', unitPrice: '125.5', discount: '0', taxRate: '0' }, // gross 502
    ]);
    expect(totals).toEqual({
      subtotal: '5002.00',
      discountTotal: '500.00',
      // tax: 2000*.18 + 2000*.18 + 0 = 360 + 360
      taxTotal: '720.00',
      // net total: (2500-500)+2000+502 = 4502 ; + tax 720 = 5222
      total: '5222.00',
    });
  });

  it('returns zeroed totals for no lines', () => {
    expect(quoteTotals([])).toEqual({
      subtotal: '0.00',
      discountTotal: '0.00',
      taxTotal: '0.00',
      total: '0.00',
    });
  });

  it('keeps large values exact (no float drift)', () => {
    const totals = quoteTotals([
      { quantity: '1000000', unitPrice: '999.99', discount: '0', taxRate: '0.18' },
    ]);
    expect(totals.subtotal).toBe('999990000.00');
    expect(totals.taxTotal).toBe('179998200.00');
    expect(totals.total).toBe('1179988200.00');
  });
});
