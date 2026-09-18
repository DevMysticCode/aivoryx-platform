'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@aivoryx/ui';

/** The shared frame every dashboard widget renders inside (§5 — hierarchy, not card-spam). */
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
  /** Arbitrary header-right content (e.g. a range toggle) — takes precedence
   *  over `href`/`linkLabel` when both are given. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col rounded-lg border bg-card', className)}>
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action ??
          (href ? (
            <Link
              href={href}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {linkLabel}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          ) : null)}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </section>
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
          tone === 'danger' && 'text-destructive',
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
