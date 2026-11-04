import { DEFAULT_TIMEZONE } from '@aivoryx/shared';

/**
 * Shared date/money formatting for generated documents and notifications
 * (Phase: tenant timezone/currency wiring). Previously duplicated, with three
 * different hardcoded locales, across builders.ts, payslip.builder.ts,
 * finance-doc.ts/quotation-doc.ts, and notifications/event-context.ts.
 */
export interface FormatLocale {
  timezone: string;
  currency: string;
}

/** Same visual format as before (ISO code prefix, e.g. "INR 1,234.56" — not a
 *  currency symbol): unchanged behavior, just centralized. `currency` is
 *  passed per-call exactly as today, since every caller already has the
 *  entity's own currency column; this never falls back to a tenant default
 *  on its own. */
export function formatMoney(v: string | null | undefined, currency?: string): string {
  const n = Number(v ?? 0);
  const s = Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(v ?? '0.00');
  return currency ? `${currency} ${s}` : s;
}

/** Same `en-GB` "02 Jan 2026" visual format as before, now honoring the
 *  tenant's configured timezone instead of implicit server/host local time.
 *  Defaults to UTC when no timezone is supplied, so existing callers that
 *  don't pass one keep deterministic (not host-dependent) output.
 *
 *  ONLY for true instants (`timestamp with timezone` columns — createdAt,
 *  a quotation's issueDate/validityDate, a visit's scheduledAt). NEVER use
 *  this for a plain `date` column (invoice issueDate/dueDate, payment
 *  paymentDate, payroll periodStart/periodEnd, leave startDate/endDate) —
 *  those are calendar dates with no time component, and reinterpreting them
 *  through a timezone conversion can shift the displayed day by ±1 depending
 *  on the tenant's offset. Use `formatCalendarDate` for those instead. */
export function formatDate(
  iso: string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats a plain `date` column (e.g. "2026-01-15") by its literal calendar
 *  components only — never parsed as an instant, never timezone-converted,
 *  since a calendar date means the same day everywhere. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  return `${d} ${MONTHS[Number(mo) - 1]} ${y}`;
}
