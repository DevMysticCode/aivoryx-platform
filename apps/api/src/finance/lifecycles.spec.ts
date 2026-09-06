import { describe, expect, it } from 'vitest';
import { dec } from './money.js';
import {
  derivedInvoiceStatus,
  invoiceAcceptsAllocation,
  invoiceIsEditable,
  invoiceIsImmutable,
  isValidCreditNoteTransition,
  isValidInvoiceTransition,
  isValidPaymentTransition,
} from './lifecycles.js';

describe('invoice lifecycle', () => {
  it('allows the forward path and cancellation', () => {
    expect(isValidInvoiceTransition('DRAFT', 'ISSUED')).toBe(true);
    expect(isValidInvoiceTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(isValidInvoiceTransition('ISSUED', 'PARTIALLY_PAID')).toBe(true);
    expect(isValidInvoiceTransition('ISSUED', 'PAID')).toBe(true);
    expect(isValidInvoiceTransition('PARTIALLY_PAID', 'PAID')).toBe(true);
    expect(isValidInvoiceTransition('ISSUED', 'VOID')).toBe(true);
  });

  it('rejects impossible transitions', () => {
    expect(isValidInvoiceTransition('DRAFT', 'PAID')).toBe(false);
    expect(isValidInvoiceTransition('PAID', 'DRAFT')).toBe(false);
    expect(isValidInvoiceTransition('CANCELLED', 'ISSUED')).toBe(false);
    expect(isValidInvoiceTransition('VOID', 'ISSUED')).toBe(false);
    expect(isValidInvoiceTransition('ISSUED', 'ISSUED')).toBe(false);
  });

  it('only a draft is editable; everything else is immutable', () => {
    expect(invoiceIsEditable('DRAFT')).toBe(true);
    expect(invoiceIsEditable('ISSUED')).toBe(false);
    expect(invoiceIsImmutable('DRAFT')).toBe(false);
    expect(invoiceIsImmutable('PARTIALLY_PAID')).toBe(true);
  });

  it('allocations are only accepted by an issued / partially-paid invoice', () => {
    expect(invoiceAcceptsAllocation('ISSUED')).toBe(true);
    expect(invoiceAcceptsAllocation('PARTIALLY_PAID')).toBe(true);
    expect(invoiceAcceptsAllocation('DRAFT')).toBe(false);
    expect(invoiceAcceptsAllocation('PAID')).toBe(false);
    expect(invoiceAcceptsAllocation('CANCELLED')).toBe(false);
  });
});

describe('derivedInvoiceStatus', () => {
  const status = (grand: string, paid: string, credited: string) => {
    const out = ((): string => {
      const v = Number(grand) - Number(paid) - Number(credited);
      return (v < 0 ? 0 : v).toFixed(2);
    })();
    return derivedInvoiceStatus(grand, paid, credited, dec.cmp, out);
  };

  it('nothing paid → ISSUED', () => {
    expect(status('1000.00', '0.00', '0.00')).toBe('ISSUED');
  });
  it('part paid → PARTIALLY_PAID', () => {
    expect(status('1000.00', '400.00', '0.00')).toBe('PARTIALLY_PAID');
    expect(status('1000.00', '0.00', '250.00')).toBe('PARTIALLY_PAID');
  });
  it('fully covered by payments or credits → PAID', () => {
    expect(status('1000.00', '1000.00', '0.00')).toBe('PAID');
    expect(status('1000.00', '600.00', '400.00')).toBe('PAID');
  });
  it('a zero-total invoice is not auto-PAID by "covered"', () => {
    expect(status('0.00', '0.00', '0.00')).toBe('ISSUED');
  });
});

describe('payment + credit-note lifecycle', () => {
  it('payment: RECORDED → REVERSED / CANCELLED only', () => {
    expect(isValidPaymentTransition('RECORDED', 'REVERSED')).toBe(true);
    expect(isValidPaymentTransition('RECORDED', 'CANCELLED')).toBe(true);
    expect(isValidPaymentTransition('REVERSED', 'RECORDED')).toBe(false);
    expect(isValidPaymentTransition('REVERSED', 'REVERSED')).toBe(false);
  });

  it('credit note: DRAFT → ISSUED / CANCELLED, ISSUED → CANCELLED', () => {
    expect(isValidCreditNoteTransition('DRAFT', 'ISSUED')).toBe(true);
    expect(isValidCreditNoteTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(isValidCreditNoteTransition('ISSUED', 'CANCELLED')).toBe(true);
    expect(isValidCreditNoteTransition('ISSUED', 'DRAFT')).toBe(false);
    expect(isValidCreditNoteTransition('CANCELLED', 'ISSUED')).toBe(false);
  });
});
