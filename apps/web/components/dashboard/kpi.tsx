'use client';

import type { ReactNode } from 'react';
import { cn } from '@aivoryx/ui';

/**
 * A single key-metric block (Phase 13D §5/§6) — generic across dashboards.
 * `delta` is only ever rendered when the caller passes a real computed value;
 * there is no default/placeholder trend so a widget can never invent one.
 */
export function Kpi({
  label,
  value,
  delta,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  delta?: { changePct: number | null; label?: string } | null;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
        {delta && delta.changePct !== null ? (
          <span
            className={cn(
              'text-xs font-medium tabular-nums',
              delta.changePct > 0 && 'text-emerald-600 dark:text-emerald-400',
              delta.changePct < 0 && 'text-destructive',
              delta.changePct === 0 && 'text-muted-foreground',
            )}
          >
            {delta.changePct > 0 ? '+' : ''}
            {delta.changePct}% {delta.label ?? 'vs prior week'}
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
