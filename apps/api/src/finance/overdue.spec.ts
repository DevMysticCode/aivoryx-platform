import { describe, expect, it } from 'vitest';
import { deriveOverdue } from './overdue.js';

const TODAY = new Date('2026-06-15T09:00:00Z');

describe('deriveOverdue', () => {
  it('is overdue when issued, past due, and still outstanding', () => {
    expect(
      deriveOverdue({ status: 'ISSUED', dueDate: '2026-06-01', outstanding: '100.00' }, TODAY),
    ).toEqual({ overdue: true, daysOverdue: 14 });
  });

  it('counts days from a partially-paid invoice too', () => {
    expect(
      deriveOverdue(
        { status: 'PARTIALLY_PAID', dueDate: '2026-06-14', outstanding: '1.00' },
        TODAY,
      ),
    ).toEqual({ overdue: true, daysOverdue: 1 });
  });

  it('is not overdue on the due date itself', () => {
    expect(
      deriveOverdue({ status: 'ISSUED', dueDate: '2026-06-15', outstanding: '100.00' }, TODAY),
    ).toEqual({ overdue: false, daysOverdue: 0 });
  });

  it('is not overdue when nothing is outstanding', () => {
    expect(
      deriveOverdue({ status: 'ISSUED', dueDate: '2026-01-01', outstanding: '0.00' }, TODAY),
    ).toEqual({ overdue: false, daysOverdue: 0 });
  });

  it('is never overdue for a draft, paid, cancelled or void invoice', () => {
    for (const status of ['DRAFT', 'PAID', 'CANCELLED', 'VOID']) {
      expect(
        deriveOverdue({ status, dueDate: '2026-01-01', outstanding: '100.00' }, TODAY).overdue,
      ).toBe(false);
    }
  });

  it('is not overdue with no due date', () => {
    expect(
      deriveOverdue({ status: 'ISSUED', dueDate: null, outstanding: '100.00' }, TODAY).overdue,
    ).toBe(false);
  });

  it('does not treat a future due date as overdue', () => {
    expect(
      deriveOverdue({ status: 'ISSUED', dueDate: '2026-12-31', outstanding: '100.00' }, TODAY)
        .overdue,
    ).toBe(false);
  });
});
