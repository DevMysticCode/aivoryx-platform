'use client';

import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { useOnboarding, useDismissOnboarding } from '@/lib/settings/use-settings';

/**
 * A resumable, skippable setup checklist for a new workspace (Phase 10,
 * ADR 0039). The step list, completion and visibility all come from the API
 * (`GET /onboarding`) — the frontend never decides what "done" means. Steps are
 * already filtered server-side to those the current user has permission to do,
 * so every link here is one this user can actually open. Non-admins have no
 * setup tasks and see nothing.
 */
export function OnboardingCard() {
  const onboarding = useOnboarding();
  const dismiss = useDismissOnboarding();
  const data = onboarding.data;

  if (!data || !data.show) return null;

  const done = data.steps.filter((s) => s.done).length;

  return (
    <section
      className="rounded-lg border bg-card p-4 sm:p-5"
      aria-label="Workspace setup checklist"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Finish setting up {data.workspaceName}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {done} of {data.steps.length} done · you can come back to this anytime.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden />
          Skip for now
        </button>
      </div>

      <ol className="mt-4 space-y-1">
        {data.steps.map((step) => (
          <li key={step.key}>
            <div
              className={cn(
                'flex items-center gap-3 rounded-md px-2 py-2',
                step.done ? 'opacity-60' : 'hover:bg-accent/50',
              )}
            >
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border text-xs',
                  step.done
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-input text-transparent',
                )}
                aria-hidden
              >
                <Check className="size-3" />
              </span>
              <span className="flex-1">
                <span className={cn('block text-sm font-medium', step.done && 'line-through')}>
                  {step.title}
                </span>
                <span className="block text-xs text-muted-foreground">{step.description}</span>
              </span>
              {!step.done && step.href ? (
                <Link
                  href={step.href}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline"
                >
                  Start
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
