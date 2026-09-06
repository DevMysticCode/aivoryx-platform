import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '@aivoryx/ui';

/** Presentational helpers shared across the Phase 5 supply surfaces (ADR 0034). */

/** Trim trailing zeros from a decimal string for display (keeps it exact). */
export function fmtQty(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}

export function fmtMoney(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

const SUPPLY_STATUS_STYLES: Record<string, string> = {
  // project lifecycle
  draft: 'bg-secondary text-secondary-foreground',
  approved: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  procurement: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ready_for_dispatch: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  in_progress: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  on_hold: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  cancelled: 'bg-destructive/10 text-destructive',
  // PO lifecycle
  submitted: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  partially_received: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  received: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  closed: 'bg-secondary text-secondary-foreground',
  // dispatch lifecycle
  dispatched: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  delivered: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  // quotation lifecycle (Phase 6, ADR 0035)
  sent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  accepted: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  booked: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  expired: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  superseded: 'bg-secondary text-secondary-foreground',
  // customer status
  prospect: 'bg-secondary text-secondary-foreground',
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  inactive: 'bg-secondary text-secondary-foreground',
  // EPC execution (Phase 7, ADR 0036)
  unassigned: 'bg-secondary text-secondary-foreground',
  assigned: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  pending: 'bg-secondary text-secondary-foreground',
  passed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-destructive/10 text-destructive',
  done: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  blocked: 'bg-destructive/10 text-destructive',
  skipped: 'bg-secondary text-secondary-foreground',
  open: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  resolved: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  verified: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  not_started: 'bg-secondary text-secondary-foreground',
  documents_pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  under_review: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  ready: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  na: 'bg-secondary text-secondary-foreground',
  low: 'bg-secondary text-secondary-foreground',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  critical: 'bg-destructive/10 text-destructive',
  // finance (Phase 9, ADR 0038)
  issued: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  partially_paid: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  paid: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  void: 'bg-secondary text-secondary-foreground',
  recorded: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  reversed: 'bg-destructive/10 text-destructive',
  overdue: 'bg-destructive/10 text-destructive',
};

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="space-y-1">
      {label ? (
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{pct}%</span>
        </div>
      ) : null}
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct === 100 ? 'bg-emerald-500' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SupplyStatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize',
        SUPPLY_STATUS_STYLES[key] ?? 'bg-secondary text-secondary-foreground',
      )}
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function Select({
  label,
  children,
  className,
  ...props
}: { label?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const el = (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
  if (!label) return el;
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {el}
    </label>
  );
}

export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
        className="rounded-md border px-3 py-1.5 disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="rounded-md border px-3 py-1.5 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
          {head}
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
