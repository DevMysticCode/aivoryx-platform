'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import { START_TOUR_EVENT, type Tour, getTour } from '@/lib/help/tours';

const HIGHLIGHT_ATTR = 'data-tour-active';

/**
 * Mounted once in the shell. Runs a short tour started via `startTour(id)`
 * (from the Help Center or a "take a tour" link). Non-modal: the page stays
 * usable, Escape or "Skip" ends it, and a step whose target is not on screen is
 * simply shown without a highlight.
 */
export function FeatureTourHost() {
  const [tour, setTour] = useState<Tour | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const onStart = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      const t = id ? getTour(id) : undefined;
      if (t) {
        setTour(t);
        setIndex(0);
      }
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, []);

  const end = useCallback(() => setTour(null), []);

  const step = tour?.steps[index];

  useEffect(() => {
    if (!step?.target) return;
    const el = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`),
    ).find((n) => n.offsetParent !== null);
    if (!el) return;
    el.setAttribute(HIGHLIGHT_ATTR, '');
    el.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    return () => el.removeAttribute(HIGHLIGHT_ATTR);
  }, [step]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && end();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tour, end]);

  if (!tour || !step) return null;
  const last = index === tour.steps.length - 1;

  return (
    <div
      role="dialog"
      aria-label={`${tour.title} — step ${index + 1} of ${tour.steps.length}`}
      className="fixed bottom-20 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-surface-raised p-4 text-sm shadow-xl md:bottom-6 md:right-6"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">
          {tour.title} · {index + 1}/{tour.steps.length}
        </p>
        <button
          type="button"
          onClick={end}
          aria-label="Close tour"
          className="rounded-md p-0.5 text-muted-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <h2 className="mt-1.5 font-semibold tracking-tight">{step.title}</h2>
      <p className="mt-1 text-muted-foreground">{step.body}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={end}>
          Skip
        </Button>
        <div className="flex gap-2">
          {index > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          ) : null}
          <Button size="sm" onClick={() => (last ? end() : setIndex(index + 1))}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
