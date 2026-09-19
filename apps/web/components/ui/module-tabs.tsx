'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { ScrollFadeRow } from './scroll-fade-row';

export interface ModuleTabItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  current: boolean;
}

/**
 * A module's sub-navigation (e.g. CRM's Overview/Leads/Customers/Visits).
 * A small, fixed set of sibling views within one module — switched often, so
 * a dropdown would cost an extra tap on a frequent interaction. Renders as a
 * single non-wrapping row that scrolls horizontally when it doesn't fit,
 * rather than wrapping onto an orphaned second line at narrow widths. Plain
 * links, not ARIA tabs (there's no associated tabpanel) — keyboard access is
 * the browser's native anchor tab order plus a visible focus ring.
 */
export function ModuleTabs({
  items,
  className,
  label,
}: {
  items: ModuleTabItem[];
  className?: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className={cn('border-b', className)}>
      <ScrollFadeRow className="pb-2">
        {items.map(({ href, label, icon: Icon, current }) => (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex shrink-0 snap-start items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              current
                ? 'bg-primary-soft font-medium text-primary'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            {label}
          </Link>
        ))}
      </ScrollFadeRow>
    </nav>
  );
}
