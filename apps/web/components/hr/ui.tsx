'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@aivoryx/ui';

/** Presentational helpers shared across the Phase 12 HR surface (ADR 0041). */

const HR_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  paid: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  reimbursed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  finalized: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  present: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  submitted: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  processing: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  payment_processing: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  partially_paid: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  draft: 'bg-secondary text-secondary-foreground',
  on_leave: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  late: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  half_day: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  rejected: 'bg-destructive/10 text-destructive',
  reimbursement_failed: 'bg-destructive/10 text-destructive',
  failed: 'bg-destructive/10 text-destructive',
  absent: 'bg-destructive/10 text-destructive',
  suspended: 'bg-destructive/10 text-destructive',
  terminated: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-secondary text-muted-foreground',
  superseded: 'bg-secondary text-muted-foreground',
  weekend: 'bg-secondary text-muted-foreground',
  holiday: 'bg-secondary text-muted-foreground',
};

export function HrStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const key = status.toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        HR_STATUS_STYLES[key] ?? 'bg-secondary text-secondary-foreground',
      )}
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function money(value: string | number | null | undefined, currency = ''): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const s = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TextField({
  label,
  hint,
  className,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        className={cn(
          'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
        {...props}
      />
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function StatCard({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  tone?: 'pos' | 'neg' | 'warn';
  href?: string;
}) {
  const body = (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'pos' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'neg' && 'text-destructive',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </div>
    </div>
  );
  if (!href) return body;
  return (
    <a href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </a>
  );
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          aria-current={active === t.key ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            active === t.key
              ? 'bg-secondary font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export function DefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
