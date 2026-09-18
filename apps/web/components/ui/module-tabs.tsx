'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@aivoryx/ui';

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
export function ModuleTabs({ items }: { items: ModuleTabItem[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const update = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();

    el.addEventListener('scroll', update, { passive: true });
    // ResizeObserver is a progressive enhancement (keeps the edge fades in
    // sync with layout changes) — its absence (older browsers, jsdom in
    // tests) shouldn't break the tabs themselves, just the fade hint.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [items.length]);

  return (
    <div className="relative border-b">
      <div
        ref={scrollerRef}
        className="flex snap-x gap-1 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ href, label, icon: Icon, current }) => (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex shrink-0 snap-start items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              current
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            {label}
          </Link>
        ))}
      </div>
      {canScrollLeft ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent"
        />
      ) : null}
      {canScrollRight ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
        />
      ) : null}
    </div>
  );
}
