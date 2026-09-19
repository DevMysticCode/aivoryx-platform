import type { ReactNode } from 'react';
import { cn } from '@aivoryx/ui';

/**
 * The one badge primitive (Phase 19). Every status pill in the product renders
 * through `Badge`, coloured by a semantic TONE, so success/warning/danger/info
 * mean the same thing everywhere, meet contrast in light AND dark, and never
 * pick up a tenant's brand colour. Each module keeps its own status → tone map
 * (the same word can mean different things per domain); only the markup and
 * colours are shared.
 */
export type Tone = 'neutral' | 'muted' | 'primary' | 'info' | 'success' | 'warning' | 'danger';

export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  muted: 'bg-secondary text-muted-foreground',
  primary: 'bg-primary-soft text-primary',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
