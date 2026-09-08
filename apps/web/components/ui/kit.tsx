'use client';

import type { ReactNode } from 'react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { Dialog } from './overlays';

/** A compact KPI tile (§5 StatCard). Numeric-forward, low chrome. */
export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A deliberate error state with a retry affordance (§44). No stack traces. */
export function ErrorBlock({
  error,
  onRetry,
  title = 'Something went wrong',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const isEntitlement =
    error instanceof ApiError && error.code === 'ENTITLEMENT_MODULE_NOT_ENABLED';
  const isForbidden = error instanceof ApiError && error.code === 'AUTH_FORBIDDEN';
  const message = isEntitlement
    ? 'Your company does not currently have access to this area.'
    : isForbidden
      ? "You don't have permission to view this."
      : error instanceof Error
        ? error.message
        : 'Please try again in a moment.';
  const ref = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
      <p className="font-medium text-foreground">{isEntitlement ? 'Access unavailable' : title}</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      {ref ? <p className="mt-1 font-mono text-xs text-muted-foreground">Ref: {ref}</p> : null}
      {onRetry && !isEntitlement && !isForbidden ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ lines = 5 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn('h-10 animate-pulse rounded-md bg-muted', i === 0 && 'h-8 w-1/3')}
        />
      ))}
    </div>
  );
}

/** A confirmation dialog for high-impact actions (§47). */
export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50',
              danger ? 'bg-destructive' : 'bg-primary',
            )}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-muted-foreground">{body}</div>
    </Dialog>
  );
}
