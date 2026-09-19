'use client';

import { createPortal } from 'react-dom';
import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cn } from '../cn.js';

/**
 * The one Aivoryx tooltip (Phase 19). Opens on hover and keyboard focus, closes
 * on blur / pointer-leave / Escape, and is wired with `aria-describedby` so
 * assistive tech reads it. It is a *label*, not interactive content — anything
 * that needs links or rich text belongs in an InfoPopover.
 *
 * The trigger must be a single focusable element (button, link). Use
 * `describe` when the trigger already has its own accessible name and the
 * tooltip is supplementary; leave it off when the tooltip IS the name of an
 * icon-only control (pair with `aria-label` on the trigger).
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  delay = 250,
  className,
  disabled,
}: {
  label: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom' | 'right' | 'left';
  delay?: number;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const reveal = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const gap = 8;
    setPos(
      side === 'top'
        ? { x: r.left + r.width / 2, y: r.top - gap }
        : side === 'bottom'
          ? { x: r.left + r.width / 2, y: r.bottom + gap }
          : side === 'right'
            ? { x: r.right + gap, y: r.top + r.height / 2 }
            : { x: r.left - gap, y: r.top + r.height / 2 },
    );
    setOpen(true);
  }, [side]);
  const show = useCallback(
    (immediate?: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      if (immediate || delay === 0) reveal();
      else timer.current = setTimeout(reveal, delay);
    },
    [delay, reveal],
  );
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hide]);

  if (disabled) return children;

  const childProps = children.props as {
    onMouseEnter?: (e: unknown) => void;
    onMouseLeave?: (e: unknown) => void;
    onFocus?: (e: unknown) => void;
    onBlur?: (e: unknown) => void;
  };

  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e: unknown) => {
      childProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: unknown) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      childProps.onFocus?.(e);
      show(true);
    },
    onBlur: (e: unknown) => {
      childProps.onBlur?.(e);
      hide();
    },
  });

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'bottom'
        ? 'translate(-50%, 0)'
        : side === 'right'
          ? 'translate(0, -50%)'
          : 'translate(-100%, -50%)';

  return (
    <span ref={anchor} className="inline-flex">
      {trigger}
      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              style={{ position: 'fixed', left: pos.x, top: pos.y, transform }}
              className={cn(
                'pointer-events-none z-[100] w-max max-w-[16rem] rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md',
                className,
              )}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
