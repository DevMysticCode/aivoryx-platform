'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { CalendarClock, Contact, Gauge, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import type { ModuleKey } from '@aivoryx/shared';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { useAccess } from '@/lib/navigation/use-access';
import { Skeleton } from '@/components/admin/ui';

interface CrmNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  permission?: string;
  module?: ModuleKey;
}

const NAV: CrmNavItem[] = [
  { href: '/crm', label: 'Overview', icon: Gauge, exact: true },
  { href: '/crm/leads', label: 'Leads', icon: Users, permission: 'crm.leads.read' },
  { href: '/customers', label: 'Customers', icon: Contact, permission: 'customers.read' },
  { href: '/crm/visits', label: 'Visits', icon: CalendarClock, module: 'FIELD' },
];

export default function CrmLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const access = useAccess();

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  if (me.isLoading || unauthenticated) {
    return (
      <div className="space-y-4">
        <Skeleton rows={4} />
      </div>
    );
  }

  if (me.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">Could not load your session.</p>
        <p className="mt-1 text-muted-foreground">{(me.error as Error).message}</p>
      </div>
    );
  }

  if (!me.data?.active) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">No active workspace selected.</p>
        <p className="mt-1 text-muted-foreground">Sign in to a workspace to use the CRM.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1 border-b pb-2">
        {NAV.filter((item) => access.can(item.permission) && access.hasModule(item.module)).map(
          ({ href, label, icon: Icon, exact }) => {
            const current = exact ? pathname === href : pathname.startsWith(href);
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
          },
        )}
      </nav>
      {children}
    </div>
  );
}
