import { describe, expect, it } from 'vitest';
import {
  assertNonNegativeMoney,
  assertPositiveMoney,
  invoiceOutstanding,
  invoiceTotals,
  lineAmounts,
  paymentUnallocated,
  sumMoney,
} from './money.js';

describe('finance money — line calculations', () => {
  it('computes gross, discount, taxable, tax and total for a flat-amount discount', () => {
    expect(
      lineAmounts({
        quantity: '10',
        unitPrice: '1000.00',
        discountType: 'AMOUNT',
        discountValue: '500.00',
        taxRate: '0.18',
      }),
    ).toEqual({
      lineSubtotal: '10000.00',
      lineDiscount: '500.00',
      lineTaxable: '9500.00',
      lineTax: '1710.00',
      lineTotal: '11210.00',
    });
  });

  it('supports a percent discount', () => {
    expect(
      lineAmounts({
        quantity: '2',
        unitPrice: '100.00',
        discountType: 'PERCENT',
        discountValue: '10', // 10%
        taxRate: '0',
      }),
    ).toEqual({
      lineSubtotal: '200.00',
      lineDiscount: '20.00',
      lineTaxable: '180.00',
      lineTax: '0.00',
      lineTotal: '180.00',
    });
  });

  it('never lets a discount exceed the line gross (100%+ discount → taxable 0)', () => {
    const a = lineAmounts({
      quantity: '1',
      unitPrice: '100.00',
      discountType: 'PERCENT',
      discountValue: '150',
      taxRate: '0.18',
    });
    expect(a.lineDiscount).toBe('100.00');
    expect(a.lineTaxable).toBe('0.00');
    expect(a.lineTax).toBe('0.00');
    expect(a.lineTotal).toBe('0.00');
  });

  it('handles zero quantity / zero tax', () => {
    expect(
      lineAmounts({
        quantity: '0',
        unitPrice: '999.99',
        discountType: 'AMOUNT',
        discountValue: '0',
        taxRate: '0',
      }),
    ).toMatchObject({ lineSubtotal: '0.00', lineTotal: '0.00' });
  });

  it('handles fractional quantity and unit price without float error', () => {
    const a = lineAmounts({
      quantity: '3.5',
      unitPrice: '0.10',
      discountType: 'AMOUNT',
      discountValue: '0',
      taxRate: '0',
    });
    expect(a.lineSubtotal).toBe('0.35'); // not 0.35000000000000003
    expect(a.lineTotal).toBe('0.35');
  });

  it('handles very large totals', () => {
    const a = lineAmounts({
      quantity: '1000000',
      unitPrice: '999999.99',
      discountType: 'AMOUNT',
      discountValue: '0',
      taxRate: '0',
    });
    expect(a.lineSubtotal).toBe('999999990000.00');
  });

  it('rounds tax half-up at the boundary', () => {
    // taxable 100.05 × 0.005 = 0.50025 → 0.50
    expect(
      lineAmounts({
        quantity: '1',
        unitPrice: '100.05',
        discountType: 'AMOUNT',
        discountValue: '0',
        taxRate: '0.005',
      }).lineTax,
    ).toBe('0.50');
  });
});

describe('finance money — invoice totals', () => {
  it('keeps grand_total = subtotal − discount + tax exact across many lines', () => {
    const lines = [
      {
        quantity: '3',
        unitPrice: '333.33',
        discountType: 'AMOUNT' as const,
        discountValue: '1.11',
        taxRate: '0.18',
      },
      {
        quantity: '7',
        unitPrice: '12.34',
        discountType: 'PERCENT' as const,
        discountValue: '5',
        taxRate: '0.05',
      },
      {
        quantity: '1',
        unitPrice: '9999.99',
        discountType: 'AMOUNT' as const,
        discountValue: '0',
        taxRate: '0',
      },
    ];
    const t = invoiceTotals(lines);
    const check = (Number(t.subtotal) - Number(t.discountTotal) + Number(t.taxTotal)).toFixed(2);
    expect(t.grandTotal).toBe(check);
  });

  it('an empty line set totals to zero', () => {
    expect(invoiceTotals([])).toEqual({
      subtotal: '0.00',
      discountTotal: '0.00',
      taxTotal: '0.00',
      grandTotal: '0.00',
    });
  });
});

describe('finance money — balances', () => {
  it('outstanding = grand − paid − credited, floored at zero', () => {
    expect(invoiceOutstanding('100000.00', '30000.00', '0')).toBe('70000.00');
    expect(invoiceOutstanding('100000.00', '90000.00', '20000.00')).toBe('0.00'); // over-covered → 0
  });

  it('unallocated = amount − allocated, floored at zero', () => {
    expect(paymentUnallocated('50000.00', '20000.00')).toBe('30000.00');
    expect(paymentUnallocated('50000.00', '50000.00')).toBe('0.00');
  });

  it('sumMoney adds a column exactly', () => {
    expect(sumMoney(['0.10', '0.20', '0.30'])).toBe('0.60');
  });
});

describe('finance money — input guards', () => {
  it('rejects non-decimal, zero and negative amounts for positive fields', () => {
    expect(() => assertPositiveMoney('abc')).toThrow(RangeError);
    expect(() => assertPositiveMoney('0')).toThrow(RangeError);
    expect(() => assertPositiveMoney('-5')).toThrow(RangeError);
    expect(assertPositiveMoney('5')).toBe('5.00');
  });

  it('allows zero but not negative for non-negative fields', () => {
    expect(assertNonNegativeMoney('0')).toBe('0.00');
    expect(() => assertNonNegativeMoney('-0.01')).toThrow(RangeError);
  });

  it('rejects absurdly large amounts', () => {
    expect(() => assertPositiveMoney('9999999999999999')).toThrow(RangeError);
  });
});
