'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button, buttonVariants, cn } from '@aivoryx/ui';

/**
 * App-wide error boundary (Phase 16 §16) — catches an uncaught render/fetch
 * exception below the root layout (a thrown error inside the root layout
 * itself needs `global-error.tsx`). Previously absent, so this class of
 * failure fell through to Next.js's default, unbranded error overlay/page —
 * violating CLAUDE.md §9 (what failed, what to do, a reference). Next.js
 * requires this file to be a client component receiving `error`/`reset`.
 */
export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-destructive">
        Something went wrong
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">This page hit an unexpected error</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Try again, or go back to the dashboard. If this keeps happening, contact your workspace
        administrator or Aivoryx support.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
