'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ComponentType, type ReactNode, useEffect } from 'react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { Skeleton } from '@/components/admin/ui';

export interface SupplyTab {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Permission that gates the tab; hidden if the member lacks it. */
  permission: string;
}

/**
 * Shared chrome for the Phase 5 operational surfaces (projects, inventory,
 * procurement, logistics — ADR 0034). Enforces an active session and renders a
 * permission-aware tab strip. No new component library (CLAUDE.md §12).
 */
export function SupplyShell({ tabs, children }: { tabs: SupplyTab[]; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  if (me.isLoading || unauthenticated) {
    return <Skeleton rows={4} />;
  }

  if (me.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">Could not load your session.</p>
        <p className="mt-1 text-muted-foreground">{(me.error as Error).message}</p>
      </div>
    );
  }

  const active = me.data?.active;
  if (!active) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">No active workspace selected.</p>
        <p className="mt-1 text-muted-foreground">Sign in to a workspace to continue.</p>
      </div>
    );
  }

  const visible = tabs.filter((t) => active.permissions.includes(t.permission));

  return (
    <div className="space-y-6">
      {visible.length > 1 ? (
        <nav className="flex flex-wrap gap-1 border-b pb-2">
          {visible.map(({ href, label, icon: Icon }) => {
            const current = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                  current
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {children}
    </div>
  );
}

/** Small helper: read the active membership's permissions on a supply page. */
export function usePermissions(): string[] {
  const me = useMe();
  return me.data?.active?.permissions ?? [];
}
