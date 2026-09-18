'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Bell, Building2 } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { Skeleton } from '@/components/admin/ui';
import { ModuleTabs } from '@/components/ui/module-tabs';

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

  const items = NAV.map(({ href, label, icon }) => ({
    href,
    label,
    icon,
    current: pathname === href || pathname?.startsWith(`${href}/`),
  }));

  return (
    <div className="space-y-6">
      <ModuleTabs items={items} />
      {children}
    </div>
  );
}
