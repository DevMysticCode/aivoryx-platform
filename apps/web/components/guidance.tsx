'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { ArrowRight, HelpCircle, Lightbulb } from 'lucide-react';
import { cn } from '@aivoryx/ui';

/**
 * One reusable guidance primitive set (Phase 10, ADR 0039) — deliberately not
 * five competing help components. Help copy is versioned in code (see
 * `help-content.ts`); there is no CMS. None of this duplicates business state
 * — lifecycle position is always derived from an API-provided status.
 */

export interface GuidanceStep {
  title: string;
  detail?: string;
}

/**
 * A concise first-use explainer for a screen: what it is, why it matters, and
 * the next thing to do. Use once near the top of a page, not per-row.
 */
export function GuidanceCard({
  title,
  children,
  steps,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  steps?: GuidanceStep[];
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-lg border border-primary/20 bg-primary/[0.03] p-4 text-sm', className)}
      aria-label={`Guidance: ${title}`}
    >
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="space-y-2">
          <h2 className="font-medium text-foreground">{title}</h2>
          {children ? <div className="text-muted-foreground">{children}</div> : null}
          {steps && steps.length > 0 ? (
            <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
              {steps.map((s) => (
                <li key={s.title}>
                  <span className="text-foreground">{s.title}</span>
                  {s.detail ? ` — ${s.detail}` : null}
                </li>
              ))}
            </ol>
          ) : null}
          {action ? (
            <Link
              href={action.href}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {action.label}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * A lightweight `?` affordance. Native `<details>` so it works without extra
 * JS and is keyboard-accessible by default.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group relative inline-block align-middle">
      <summary
        className="inline-flex cursor-pointer list-none items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={label}
        title={label}
      >
        <HelpCircle className="size-4" aria-hidden />
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-64 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
        {children}
      </div>
    </details>
  );
}

/**
 * A read-only lifecycle indicator. `steps` is the fixed ordered set of states
 * for an entity; `current` is the API's authoritative status value. The
 * frontend never advances or infers state — it only points at where the record
 * already is.
 */
export function LifecycleTrail({
  steps,
  current,
  className,
}: {
  steps: { key: string; label: string }[];
  current: string;
  className?: string;
}) {
  const idx = steps.findIndex((s) => s.key.toLowerCase() === current.toLowerCase());
  return (
    <ol className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', className)}>
      {steps.map((s, i) => {
        const state = idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
                state === 'current' && 'border-primary bg-primary/10 font-medium text-primary',
                state === 'done' && 'border-transparent bg-secondary text-secondary-foreground',
                state === 'todo' && 'border-dashed text-muted-foreground',
              )}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span className="text-muted-foreground" aria-hidden>
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
