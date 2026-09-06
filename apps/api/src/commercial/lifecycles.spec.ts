import { describe, expect, it } from 'vitest';
import {
  isTerminalQuotationStatus,
  isValidQuotationTransition,
  quotationCanBook,
  quotationCanRevise,
  quotationIsEditable,
} from './lifecycles.js';

describe('quotation lifecycle', () => {
  it('allows the documented forward path', () => {
    expect(isValidQuotationTransition('DRAFT', 'SENT')).toBe(true);
    expect(isValidQuotationTransition('SENT', 'ACCEPTED')).toBe(true);
    expect(isValidQuotationTransition('ACCEPTED', 'BOOKED')).toBe(true);
  });

  it('allows cancellation from DRAFT and SENT, and expiry from SENT', () => {
    expect(isValidQuotationTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(isValidQuotationTransition('SENT', 'CANCELLED')).toBe(true);
    expect(isValidQuotationTransition('SENT', 'EXPIRED')).toBe(true);
  });

  it('rejects skipping states', () => {
    expect(isValidQuotationTransition('DRAFT', 'ACCEPTED')).toBe(false);
    expect(isValidQuotationTransition('DRAFT', 'BOOKED')).toBe(false);
    expect(isValidQuotationTransition('SENT', 'BOOKED')).toBe(false);
  });

  it('rejects transitions out of terminal states', () => {
    expect(isValidQuotationTransition('BOOKED', 'CANCELLED')).toBe(false);
    expect(isValidQuotationTransition('CANCELLED', 'DRAFT')).toBe(false);
    expect(isValidQuotationTransition('EXPIRED', 'SENT')).toBe(false);
    expect(isValidQuotationTransition('ACCEPTED', 'CANCELLED')).toBe(false);
  });

  it('treats a no-op transition as invalid', () => {
    expect(isValidQuotationTransition('DRAFT', 'DRAFT')).toBe(false);
  });

  it('identifies terminal statuses', () => {
    expect(isTerminalQuotationStatus('BOOKED')).toBe(true);
    expect(isTerminalQuotationStatus('CANCELLED')).toBe(true);
    expect(isTerminalQuotationStatus('EXPIRED')).toBe(true);
    expect(isTerminalQuotationStatus('DRAFT')).toBe(false);
    expect(isTerminalQuotationStatus('ACCEPTED')).toBe(false);
  });

  it('only a draft quotation is editable', () => {
    expect(quotationIsEditable('DRAFT')).toBe(true);
    for (const s of ['SENT', 'ACCEPTED', 'BOOKED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(quotationIsEditable(s)).toBe(false);
    }
  });

  it('only an open quotation can be revised', () => {
    expect(quotationCanRevise('DRAFT')).toBe(true);
    expect(quotationCanRevise('SENT')).toBe(true);
    expect(quotationCanRevise('ACCEPTED')).toBe(false);
    expect(quotationCanRevise('BOOKED')).toBe(false);
  });

  it('only an accepted quotation can be booked', () => {
    expect(quotationCanBook('ACCEPTED')).toBe(true);
    expect(quotationCanBook('SENT')).toBe(false);
    expect(quotationCanBook('BOOKED')).toBe(false);
  });
});
