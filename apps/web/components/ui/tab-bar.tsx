'use client';

import { cn } from '@aivoryx/ui';
import { ScrollFadeRow } from './scroll-fade-row';

/**
 * In-page tab-panel switching (as opposed to `ModuleTabs`, which navigates
 * between routes) — a labelled set of buttons, one active at a time, with the
 * same non-wrapping scroll-fade row `ModuleTabs` uses. Originally HR-only
 * (`components/hr/ui.tsx`, re-exported from there for its existing callers);
 * promoted here once EPC execution needed the identical pattern for its
 * 7-tab record view.
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
  return (
    <div className="border-b">
      <ScrollFadeRow className="pb-2">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-current={active === t.key ? 'page' : undefined}
              onClick={() => onChange(t.key)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active === t.key
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
