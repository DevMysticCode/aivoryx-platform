'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@aivoryx/ui';

/** Presentational helpers shared across the Phase 12 HR surface (ADR 0041). */

export { TabBar } from '@/components/ui/tab-bar';

const HR_STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/10 text-success',
  onboarding: 'bg-info/10 text-info',
  archived: 'bg-secondary text-muted-foreground',
  approved: 'bg-success/10 text-success',
  paid: 'bg-success/10 text-success',
  reimbursed: 'bg-success/10 text-success',
  finalized: 'bg-info/10 text-info',
  present: 'bg-success/10 text-success',
  submitted: 'bg-warning/10 text-warning',
  pending: 'bg-warning/10 text-warning',
  processing: 'bg-warning/10 text-warning',
  payment_processing: 'bg-warning/10 text-warning',
  partially_paid: 'bg-warning/10 text-warning',
  draft: 'bg-secondary text-secondary-foreground',
  on_leave: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  late: 'bg-warning/10 text-warning',
  half_day: 'bg-warning/10 text-warning',
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
          tone === 'pos' && 'text-success',
          tone === 'neg' && 'text-destructive',
          tone === 'warn' && 'text-warning',
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

export function DefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
