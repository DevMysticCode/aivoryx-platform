'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { CalendarDays, HardHat, ListChecks, UserPlus } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { Skeleton } from '@/components/admin/ui';

const NAV = [
  { href: '/field', label: 'Today', icon: CalendarDays },
  { href: '/field/visits', label: 'Visits', icon: ListChecks },
  { href: '/field/projects', label: 'Projects', icon: HardHat },
  { href: '/field/leads/new', label: 'New lead', icon: UserPlus },
];

/**
 * The Field Agent mobile PWA (Phase 4, ADR 0033) — a genuinely mobile-first
 * surface with its own bottom-nav chrome, deliberately outside `AppShell`
 * (see `components/app-shell.tsx`). A field agent does not need — and should
 * not be routed through — the desktop CRM/admin shell.
 */
export default function FieldLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  if (me.isLoading || unauthenticated) {
    return (
      <div className="mx-auto max-w-md p-4">
        <Skeleton rows={4} />
      </div>
    );
  }

  if (me.error) {
    return (
      <div className="mx-auto max-w-md p-4 text-sm">
        <p className="font-medium text-destructive">Could not load your session.</p>
        <p className="mt-1 text-muted-foreground">{(me.error as Error).message}</p>
      </div>
    );
  }

  const active = me.data?.active;
  const canUseField = !!active?.permissions.includes('field.visits.read');

  if (!active) {
    return (
      <div className="mx-auto max-w-md p-4 text-sm">
        <p className="font-medium">No active workspace selected.</p>
        <p className="mt-1 text-muted-foreground">Sign in to a workspace to use the field app.</p>
      </div>
    );
  }

  if (!canUseField) {
    return (
      <div className="mx-auto max-w-md p-4 text-sm">
        <p className="font-medium">This account is not a field agent.</p>
        <p className="mt-1 text-muted-foreground">
          Ask a workspace administrator to designate you as a field agent to use this app.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-bold">A</span>
        </span>
        <span className="text-sm font-semibold tracking-tight">Field</span>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md">
          {NAV.map(({ href, label, icon: Icon }) => {
            const current = href === '/field' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs',
                  current ? 'font-medium text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
