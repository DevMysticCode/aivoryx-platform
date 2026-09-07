import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';

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
  return <div className={cn('rounded-lg border p-4', className)}>{children}</div>;
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
  invited: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  suspended: 'bg-destructive/10 text-destructive',
  // CRM lead lifecycle (ADR 0031)
  new: 'bg-secondary text-secondary-foreground',
  assigned: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  contacted: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  qualified: 'bg-primary/10 text-primary',
  disqualified: 'bg-destructive/10 text-destructive',
  converted: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  // visit lifecycle (ADR 0033)
  scheduled: 'bg-secondary text-secondary-foreground',
  in_progress: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-destructive/10 text-destructive',
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
  const isApi = error instanceof ApiError;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const correlationId = isApi ? error.correlationId : undefined;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="font-medium text-destructive">{message}</p>
      {correlationId ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground">Reference: {correlationId}</p>
      ) : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-secondary/50" />
      ))}
    </div>
  );
}
