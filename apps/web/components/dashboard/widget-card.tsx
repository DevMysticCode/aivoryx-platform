'use client';

import type { ReactNode } from 'react';
import { cn } from '@aivoryx/ui';
import { DashboardCard } from '@/components/dashboard-kit';

/** The frame every module-insight widget renders inside — now the shared DashboardCard. */
export function WidgetCard({
  title,
  href,
  linkLabel = 'Open',
  action,
  children,
  className,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  /** Arbitrary header-right content (wins over `href`/`linkLabel`). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DashboardCard
      title={title}
      href={href}
      linkLabel={linkLabel}
      action={action}
      className={cn('h-full', className)}
    >
      {children}
    </DashboardCard>
  );
}

export function WidgetStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'warn' | 'danger' | 'good';
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-xl font-semibold tabular-nums',
          tone === 'warn' && 'text-warning',
          tone === 'danger' && 'text-danger',
          tone === 'good' && 'text-success',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-8 animate-pulse rounded bg-secondary motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

export function WidgetError({ onRetry }: { onRetry?: () => void }) {
  return (
    <p className="text-xs text-muted-foreground">
      Couldn’t load this right now.{' '}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-primary hover:underline"
        >
          Retry
        </button>
      ) : null}
    </p>
  );
}
