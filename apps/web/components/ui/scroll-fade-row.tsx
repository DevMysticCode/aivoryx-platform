'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A single non-wrapping horizontally-scrolling row with subtle edge-fade
 * hints when content overflows — the shared behavior behind both `ModuleTabs`
 * (routed module sub-navigation) and `TabBar` (in-page tab-panel switching).
 * Extracted so any tab-like row gets the same "no wrap, scrolls instead"
 * fix rather than each one reimplementing it (Phase 15 P0 fixed CRM's module
 * nav this way; Phase 15.1 propagates the same fix to every other tab row).
 */
export function ScrollFadeRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
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
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [children]);

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className={
          'flex snap-x gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
          (className ?? '')
        }
      >
        {children}
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
