import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@aivoryx/ui';
import type { InactiveMembership, MembershipSummary } from '@aivoryx/contracts';
import { ApiError } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/error-message';

/**
 * Small presentational primitives for the admin surface, built only from
 * Tailwind + the shared design tokens (no new component library — CLAUDE.md §12).
 */

const INACTIVE_REASON_COPY: Record<string, { title: string; body: string }> = {
  AUTH_MEMBERSHIP_SUSPENDED: {
    title: 'Your access has been suspended',
    body: 'A workspace administrator suspended your membership here. Contact them to restore your access.',
  },
  TENANT_SUSPENDED: {
    title: 'This workspace is suspended',
    body: 'This workspace has been suspended. Contact your workspace administrator, or Aivoryx support if you believe this is a mistake.',
  },
  TENANT_PROVISIONING: {
    title: 'This workspace is still being set up',
    body: 'Your workspace is being provisioned — this usually only takes a few minutes. Try again shortly.',
  },
  TENANT_ARCHIVED: {
    title: 'This workspace has been archived',
    body: 'This workspace has been archived and is no longer available.',
  },
};

/**
 * The "you have no usable tenant right now" screen every top-level layout
 * shows in place of its content (Phase 16 §2/§8/§18). Distinguishes a
 * specific, known reason (membership suspended, tenant suspended/
 * provisioning/archived — from `/auth/me`'s `inactiveMembership`) from the
 * generic case of a user with no membership at all, rather than showing the
 * same "no active workspace" message for every one of those situations.
 */
export function WorkspaceUnavailable({
  inactiveMembership,
  memberships,
}: {
  inactiveMembership?: InactiveMembership | null;
  /** Pass `me.data?.memberships` so a user with another usable workspace is told to switch. */
  memberships?: MembershipSummary[];
}) {
  const copy = inactiveMembership ? INACTIVE_REASON_COPY[inactiveMembership.reason] : undefined;
  const hasOtherUsable = (memberships ?? []).some(
    (m) => m.status === 'active' && m.tenantStatus === 'active',
  );
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
      <p className="font-medium">{copy?.title ?? 'No active workspace selected'}</p>
      <p className="mt-1 text-muted-foreground">
        {copy?.body ??
          'Your account is signed in but has no usable workspace membership. Ask an administrator to add you to a workspace, then sign in again.'}
        {hasOtherUsable
          ? ' You have another workspace available — use the account menu to switch.'
          : ''}
      </p>
    </div>
  );
}

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
