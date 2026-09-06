'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Bell, Building2 } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { Skeleton } from '@/components/admin/ui';

const NAV = [
  { href: '/settings/company', label: 'Company', icon: Building2 },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
];

/**
 * Personal + workspace settings (Phase 10, ADR 0039). "Company" is the tenant
 * company profile & branding (permissioned); "Notifications" is the per-user
 * preference screen from Phase 8.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
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

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1 border-b pb-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const current = pathname === href || pathname?.startsWith(`${href}/`);
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
      {children}
    </div>
  );
}
