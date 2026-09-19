import type { ReactNode } from 'react';
import { cn } from '@aivoryx/ui';

/**
 * One line of guidance under a field. Give the input `aria-describedby={id}` so
 * the hint is read with the field. Reserve it for fields whose meaning is not
 * obvious from the label; do not add it to every input.
 */
export function HelperText({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('text-xs text-subtle', className)}>
      {children}
    </p>
  );
}
