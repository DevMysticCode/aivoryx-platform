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
};

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
