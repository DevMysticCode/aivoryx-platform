import { dec } from './money.js';

/**
 * Overdue is a DERIVED financial condition (Phase 9, ADR 0038) — never a
 * lifecycle status and never mutated by a cron. An invoice is overdue when it
 * is issued (or partially paid), its due date has passed, and it still has an
 * outstanding balance.
 */

export interface OverdueInput {
  status: string;
  dueDate: string | null; // 'YYYY-MM-DD'
  outstanding: string; // 2dp money string
}

export interface OverdueResult {
  overdue: boolean;
  daysOverdue: number;
}

/** `today` defaults to the current UTC date; pass it explicitly in tests. */
export function deriveOverdue(input: OverdueInput, today: Date = new Date()): OverdueResult {
  const active = input.status === 'ISSUED' || input.status === 'PARTIALLY_PAID';
  if (!active || !input.dueDate || !dec.gt(input.outstanding, '0')) {
    return { overdue: false, daysOverdue: 0 };
  }
  const due = Date.parse(`${input.dueDate}T00:00:00Z`);
  if (Number.isNaN(due)) return { overdue: false, daysOverdue: 0 };
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const diffDays = Math.floor((now - due) / 86_400_000);
  return diffDays > 0
    ? { overdue: true, daysOverdue: diffDays }
    : { overdue: false, daysOverdue: 0 };
}
