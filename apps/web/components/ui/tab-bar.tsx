'use client';

import { useRef } from 'react';
import { cn } from '@aivoryx/ui';
import { ScrollFadeRow } from './scroll-fade-row';

/**
 * In-page tab-panel switching (as opposed to `ModuleTabs`, which navigates
 * between routes) — real ARIA tabs (Phase 16 §20): `role="tablist"`/`"tab"` +
 * `aria-selected`, a roving tabindex, and Left/Right arrow-key navigation
 * (the WAI-ARIA "automatic activation" tabs pattern) rather than `aria-current`
 * on a plain button, which is the correct role for a navigation link, not a
 * tab-panel switch. Shares the same non-wrapping scroll-fade row `ModuleTabs`
 * uses. Originally HR-only (`components/hr/ui.tsx`, re-exported from there for
 * its existing callers); promoted here once EPC execution needed the
 * identical pattern for its 7-tab record view.
 */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (k: T) => void;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const move = (from: number, dir: 1 | -1) => {
    const next = tabs[(from + dir + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.key);
    refs.current.get(next.key)?.focus();
  };

  return (
    <div className="border-b">
      <ScrollFadeRow className="pb-2">
        <div role="tablist" className="flex gap-1">
          {tabs.map((t, i) => (
            <button
              key={t.key}
              ref={(el) => {
                if (el) refs.current.set(t.key, el);
                else refs.current.delete(t.key);
              }}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              tabIndex={active === t.key ? 0 : -1}
              onClick={() => onChange(t.key)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active === t.key
                  ? 'bg-primary-soft font-medium text-primary'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </ScrollFadeRow>
    </div>
  );
}
