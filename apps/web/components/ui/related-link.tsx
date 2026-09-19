import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@aivoryx/ui';

/**
 * A subtle, real link to a record owned by ANOTHER module (Phase 18) — a lead from
 * a visit, a visit from a quotation, a project from its quotation. Always an
 * anchor (never a clickable div), so it is keyboard- and screen-reader-friendly.
 * Render it only when the caller may open the destination (see
 * `useCrossModuleAccess`); the API still enforces access on the destination.
 */
export function RelatedLink({
  href,
  kind,
  children,
  meta,
  className,
}: {
  href: string;
  /** what kind of record this points to, e.g. "Lead", "Visit" — read aloud before the name */
  kind: string;
  children: ReactNode;
  /** short secondary text (status, date, number) */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-w-0 max-w-full items-baseline gap-1.5 rounded-sm text-sm text-primary hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground no-underline">
        {kind}
      </span>
      <span className="min-w-0 truncate">{children}</span>
      {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
    </Link>
  );
}
