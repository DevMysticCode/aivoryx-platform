import Link from 'next/link';
import { buttonVariants, cn } from '@aivoryx/ui';

/**
 * App-wide 404 (Phase 16 §16) — the app previously had no `not-found.tsx`, so
 * an unmatched route fell through to Next.js's stock, unbranded 404 with no
 * "what to do next". Still rendered inside the root layout/shell (only a
 * thrown render error needs `global-error.tsx`), so navigation stays available.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you're looking for doesn't exist, or you may not have access to it.
      </p>
      <Link href="/" className={cn(buttonVariants(), 'mt-2')}>
        Go to dashboard
      </Link>
    </div>
  );
}
