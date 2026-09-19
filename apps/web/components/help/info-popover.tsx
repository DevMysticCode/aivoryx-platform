'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@aivoryx/ui';

/**
 * A small "i" affordance that opens a short explanation. Unlike a Tooltip it can
 * hold structure (lists, a docs link) and is click/keyboard-activated:
 * `aria-expanded` + `aria-controls`, Escape closes and returns focus, an outside
 * click closes. Use for concepts a user may genuinely not know; never for
 * obvious controls.
 */
export function InfoPopover({
  label,
  children,
  align = 'start',
  className,
}: {
  /** accessible name of the trigger, e.g. "About data scope" */
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={root} className={cn('relative inline-flex align-middle', className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-5 items-center justify-center rounded-full text-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          id={id}
          role="region"
          aria-label={label}
          className={cn(
            'absolute top-full z-40 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-surface-raised p-3 text-left text-xs font-normal normal-case tracking-normal text-foreground shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}
