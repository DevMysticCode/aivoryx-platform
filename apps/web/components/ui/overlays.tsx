'use client';

import { type ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { cn } from '@aivoryx/ui';

/** Trap focus inside `ref` while `active`, restoring focus on teardown. */
function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const selector =
      'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(selector));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [active, ref]);
}

function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** wider modal for editors */
  size?: 'sm' | 'md' | 'lg';
}

/** An accessible modal dialog: backdrop, Esc, focus trap, labelled by its title. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDismiss(open, onClose);
  useFocusTrap(open, ref);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4 pt-[10vh] backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'w-full rounded-xl border bg-background shadow-xl',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
        )}
      >
        <div className="border-b px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {children ? <div className="px-5 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t bg-secondary/30 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  side?: 'left' | 'right';
}

/** A slide-over panel — used for the mobile "More" navigation and filters. */
export function Sheet({ open, onClose, title, children, side = 'right' }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDismiss(open, onClose);
  useFocusTrap(open, ref);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'absolute inset-y-0 flex w-[min(20rem,85vw)] flex-col border bg-background shadow-xl',
          side === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">{children}</div>
      </div>
    </div>
  );
}

export interface MenuProps {
  /** the trigger element; gets `onClick` + `aria-expanded` wired */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A small dropdown menu: click-outside + Esc dismiss, right/left aligned. */
export function Menu({ trigger, children, align = 'end', open, onOpenChange }: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => onOpenChange(!open) })}
      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute z-40 mt-2 min-w-56 rounded-lg border bg-background p-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  href,
  danger,
  icon,
}: {
  children: ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  icon?: ReactNode;
}) {
  const cls = cn(
    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
    danger
      ? 'text-destructive hover:bg-destructive/10'
      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
  );
  if (href) {
    return (
      <a role="menuitem" href={href} className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" onClick={onSelect} className={cls}>
      {icon}
      {children}
    </button>
  );
}
