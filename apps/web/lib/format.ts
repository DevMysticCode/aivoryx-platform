/** Shared money/date formatting for views in scope for tenant currency/timezone
 *  (finance dashboard widgets, invoice/quotation/payroll views) — promoted
 *  from a file-local copy in finance-widgets.tsx so it isn't reimplemented
 *  per view. Not applied to the app's other, unrelated timestamp displays. */

export function formatCurrency(currency: string, amount: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${currency} ${amount}`;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

/** For true-instant values (e.g. `createdAt`). Honors the tenant's configured
 *  timezone; defaults to UTC when none is supplied. */
export function formatDate(iso: string | null | undefined, timezone: string = 'UTC'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  });
}
