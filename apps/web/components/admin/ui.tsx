import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/error-message';

/**
 * Small presentational primitives for the admin surface, built only from
 * Tailwind + the shared design tokens (no new component library — CLAUDE.md §12).
 */

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  /** optional right-aligned action slot */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border bg-card p-4', className)}>{children}</div>;
}

export const Field = forwardRef<
  HTMLInputElement,
  { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>
>(function Field({ label, hint, className, ...props }, ref) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
});

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-primary/10 text-primary',
  invited: 'bg-warning/10 text-warning',
  suspended: 'bg-destructive/10 text-destructive',
  // CRM lead lifecycle (ADR 0031)
  new: 'bg-secondary text-secondary-foreground',
  assigned: 'bg-warning/10 text-warning',
  contacted: 'bg-info/10 text-info',
  qualified: 'bg-primary/10 text-primary',
  disqualified: 'bg-destructive/10 text-destructive',
  converted: 'bg-success/10 text-success',
  // visit lifecycle (ADR 0033)
  scheduled: 'bg-secondary text-secondary-foreground',
  in_progress: 'bg-info/10 text-info',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-destructive/10 text-destructive',
  // tenant lifecycle (Phase 14 §14) — using the new semantic warning/success
  // tokens (packages/ui styles.css) rather than another ad hoc amber literal;
  // pre-existing statuses above are left as-is (see PRODUCT-UX.md "Design
  // tokens" — a full repaint of every existing badge is deliberately out of
  // scope for this phase, not an oversight).
  provisioning: 'bg-warning/10 text-warning',
  archived: 'bg-secondary text-muted-foreground',
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize',
        STATUS_STYLES[key] ?? 'bg-secondary text-secondary-foreground',
      )}
    >
      {status}
    </span>
  );
}

export function RoleChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded border bg-secondary/40 px-1.5 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

/** Actionable error box — states the failure, the reference id, and (where known) the fix. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = getErrorMessage(error);
  const correlationId = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="font-medium text-destructive">{message}</p>
      {correlationId ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground">Reference: {correlationId}</p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  children,
  icon: Icon,
  action,
}: {
  children: ReactNode;
  /** Optional — most empty states don't need one; reach for it only when a
   *  glance-able icon genuinely helps (e.g. "no results" vs. "nothing here yet"). */
  icon?: (props: { className?: string }) => ReactNode;
  /** Optional call-to-action rendered below the message (e.g. a "Create…" button). */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {Icon ? <Icon className="size-8 text-muted-foreground/60" /> : null}
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-md bg-secondary motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
