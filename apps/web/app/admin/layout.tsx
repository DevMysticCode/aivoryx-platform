'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import {
  Bell,
  Building2,
  KeyRound,
  MapPin,
  Plug,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { Skeleton, WorkspaceUnavailable } from '@/components/admin/ui';
import { ModuleTabs } from '@/components/ui/module-tabs';

const NAV = [
  { href: '/admin', label: 'Overview', icon: ShieldCheck },
  { href: '/admin/members', label: 'Members', icon: Users },
  { href: '/admin/access', label: 'Access', icon: KeyRound },
  { href: '/admin/field-agents', label: 'Field agents', icon: MapPin },
  { href: '/admin/settings', label: 'Workspace settings', icon: Building2 },
  { href: '/admin/integrations', label: 'Integrations', icon: Plug },
  { href: '/admin/notifications', label: 'Notifications', icon: Bell },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();

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

  const active = me.data?.active;

  if (!active) {
    return (
      <WorkspaceUnavailable
        inactiveMembership={me.data?.inactiveMembership}
        memberships={me.data?.memberships}
      />
    );
  }

  const items = NAV.map(({ href, label, icon }) => ({
    href,
    label,
    icon,
    current: pathname === href,
  }));

  return (
    <div className="space-y-6">
      <ModuleTabs items={items} />
      {children}
    </div>
  );
}
