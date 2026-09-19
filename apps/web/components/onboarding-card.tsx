'use client';

import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import { useOnboarding, useDismissOnboarding } from '@/lib/settings/use-settings';

/**
 * The workspace onboarding checklist (Phase 10, ADR 0039; slimmed in Phase 19).
 * The step list, completion and visibility all come from the API
 * (`GET /onboarding`) — the frontend never decides what "done" means. Steps are
 * already filtered server-side to those the current user has permission to do,
 * so every link here is one this user can open. Only the steps still to do are
 * listed; finished ones collapse into a count so the card shrinks as the
 * workspace is set up. Non-admins have no setup tasks and see nothing.
 */
export function OnboardingCard() {
  const onboarding = useOnboarding();
  const dismiss = useDismissOnboarding();
  const data = onboarding.data;

  if (!data || !data.show) return null;

  const done = data.steps.filter((s) => s.done).length;
  const pending = data.steps.filter((s) => !s.done);

  return (
    <section className="rounded-lg border bg-surface p-4" aria-label="Workspace setup checklist">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Finish setting up {data.workspaceName}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-secondary"
              role="presentation"
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${(done / Math.max(1, data.steps.length)) * 100}%` }}
              />
            </span>
            {done} of {data.steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="size-3.5" aria-hidden />
          {dismiss.isPending ? 'Dismissing…' : 'Skip for now'}
        </button>
      </div>

      <ol className="mt-3 divide-y divide-border-subtle">
        {pending.map((step) => (
          <li key={step.key} className="flex items-center gap-3 py-2">
            <span
              className="grid size-5 shrink-0 place-items-center rounded-full border border-input"
              aria-hidden
            >
              <Check className="size-3 text-transparent" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{step.title}</span>
              <span className="block text-xs text-muted-foreground">{step.description}</span>
            </span>
            {step.href ? (
              <Link
                href={step.href}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                Start
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
