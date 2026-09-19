'use client';

import { useEffect, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Button, cn } from '@aivoryx/ui';
import { Badge, type Tone } from '@/components/ui/status-badge';

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

const SUPPLY_STATUS_STYLES: Record<string, Tone> = {
  // project lifecycle
  draft: 'neutral',
  approved: 'info',
  procurement: 'warning',
  ready_for_dispatch: 'primary',
  in_progress: 'info',
  completed: 'success',
  on_hold: 'warning',
  cancelled: 'danger',
  // PO lifecycle
  submitted: 'info',
  partially_received: 'warning',
  received: 'success',
  closed: 'neutral',
  // dispatch lifecycle
  dispatched: 'info',
  delivered: 'success',
  // quotation lifecycle (Phase 6, ADR 0035)
  sent: 'info',
  accepted: 'primary',
  booked: 'success',
  expired: 'warning',
  superseded: 'neutral',
  // customer status
  prospect: 'neutral',
  active: 'success',
  inactive: 'neutral',
  // EPC execution (Phase 7, ADR 0036)
  unassigned: 'neutral',
  assigned: 'info',
  pending: 'neutral',
  passed: 'success',
  failed: 'danger',
  done: 'success',
  blocked: 'danger',
  skipped: 'neutral',
  open: 'warning',
  resolved: 'info',
  verified: 'success',
  not_started: 'neutral',
  documents_pending: 'warning',
  under_review: 'info',
  ready: 'info',
  na: 'neutral',
  low: 'neutral',
  medium: 'warning',
  high: 'warning',
  critical: 'danger',
  // finance (Phase 9, ADR 0038)
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'neutral',
  recorded: 'success',
  reversed: 'danger',
  overdue: 'danger',
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
            pct === 100 ? 'bg-success' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SupplyStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={SUPPLY_STATUS_STYLES[status.toLowerCase()] ?? 'neutral'}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
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
        'h-9 w-full rounded-md border border-input bg-surface px-3 text-sm',
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
        className="min-h-9 rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover disabled:opacity-40"
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
        className="min-h-9 rounded-md border border-border px-3 py-1.5 hover:bg-surface-hover disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border-subtle bg-background-muted text-left text-xs font-medium text-muted-foreground">
          {head}
        </thead>
        <tbody className="divide-y divide-border-subtle">{children}</tbody>
      </table>
    </div>
  );
}

/** Wrapping filter row: fields flow onto new lines on narrow screens; the count sits at the end. */
export function Toolbar({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3 [&>*]:min-w-[10rem] [&>*]:flex-1 sm:[&>*]:flex-none sm:[&>*]:basis-56">
      {children}
      {count ? (
        <div className="ml-auto !flex-none self-center text-sm text-muted-foreground">{count}</div>
      ) : null}
    </div>
  );
}

/**
 * Primary page action for screens whose create form lives inline on the page: scrolls to
 * the form (by element id) and focuses its first control. Permission gating stays with
 * the caller — render it only when the form itself is rendered.
 */
export const OPEN_FORM_EVENT = 'aivoryx:open-form';

/**
 * A create form that stays out of the way until asked for: lists lead the page
 * (tables first), and the page's primary action reveals the form. `id` is the
 * key `JumpToFormButton` targets. Once opened it stays open for the visit.
 */
export function FormDisclosure({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ id: string }>).detail?.id === id) setOpen(true);
    };
    window.addEventListener(OPEN_FORM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_FORM_EVENT, onOpen);
  }, [id]);
  if (!open) return null;
  return <div id={id}>{children}</div>;
}

/**
 * The primary action of a supply / finance list page whose create form is inline:
 * reveals the form (see `FormDisclosure`), scrolls to it and focuses its first
 * control. Permission gating stays with the caller — render it only when the
 * form itself is rendered.
 */
export function JumpToFormButton({
  targetId,
  children,
  variant = 'primary',
}: {
  targetId: string;
  children: ReactNode;
  variant?: 'primary' | 'outline';
}) {
  return (
    <Button
      type="button"
      variant={variant}
      onClick={() => {
        window.dispatchEvent(new CustomEvent(OPEN_FORM_EVENT, { detail: { id: targetId } }));
        window.requestAnimationFrame(() => {
          const el = document.getElementById(targetId);
          if (!el) return;
          el.scrollIntoView({ block: 'start' });
          (el.closest('form, .rounded-lg') ?? el)
            .querySelector<HTMLElement>('input, select, textarea')
            ?.focus();
        });
      }}
    >
      {children}
    </Button>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge>;
}
