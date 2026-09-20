'use client';

import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@aivoryx/ui';

/**
 * Password input with a show/hide control. The toggle is a `type="button"` (never submits the
 * form), keeps keyboard focus on itself (it is not re-rendered or refocused), reserves its own
 * space inside the input (no layout shift) and reports its state via `aria-pressed`.
 */
export const PasswordField = forwardRef<
  HTMLInputElement,
  { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>
>(function PasswordField({ label, className, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className="block space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={visible ? 'text' : 'password'}
          // stop mobile keyboards from "helpfully" altering a password
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            'h-9 w-full rounded-md border border-input bg-surface pl-3 pr-10 text-sm placeholder:text-subtle',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <button
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={inputId}
          title={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
          // keep focus in the input when tapped with a pointer (no keyboard pop / caret jump)
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            'absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
});
