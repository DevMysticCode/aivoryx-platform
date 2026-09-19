'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import { useLocalFlag } from '@/lib/help/use-local-flag';

/**
 * First-use orientation for ONE module (not an app-wide tour). Shows only while
 * `show` is true (callers pass "this module has no data yet"), can be dismissed
 * once, and never returns after dismissal on this browser. It states what the
 * area is for and offers the single most useful next action.
 */
export function ModuleWelcome({
  id,
  title,
  description,
  steps,
  action,
  show = true,
}: {
  /** stable id, e.g. "crm" — the dismissal key */
  id: string;
  title: string;
  description: string;
  steps?: string[];
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  show?: boolean;
}) {
  const dismissed = useLocalFlag(`aivoryx.welcome.${id}`);
  if (!show || !dismissed.ready || dismissed.value) return null;

  return (
    <section
      aria-label={title}
      className="relative rounded-lg border border-primary/20 bg-primary-soft p-4 pr-10 text-sm"
    >
      <button
        type="button"
        onClick={() => dismissed.set(true)}
        aria-label={`Dismiss ${title}`}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <X className="size-4" aria-hidden />
      </button>
      <h2 className="font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>
      {steps && steps.length > 0 ? (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-muted-foreground">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {action && 'href' in action ? (
          <Link
            href={action.href}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            {action.label}
          </Link>
        ) : action ? (
          <Button size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => dismissed.set(true)}>
          Skip
        </Button>
      </div>
    </section>
  );
}
