'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { useAccess } from '@/lib/navigation/use-access';
import { useDashboardWidgets } from '@/lib/dashboard/use-dashboard';
import { LoadingBlock } from '@/components/ui/kit';

const SPAN_CLASS: Record<number, string> = {
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  6: 'md:col-span-6',
  12: 'md:col-span-12',
};

export default function DashboardPage() {
  const router = useRouter();
  const me = useMe();
  const access = useAccess();
  const { isLoading, widgets } = useDashboardWidgets();

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
    // a platform admin with no workspace belongs in the platform console
    else if (me.data && !me.data.active && me.data.isPlatformAdmin) router.replace('/platform');
  }, [unauthenticated, me.data, router]);

  if (me.isLoading || unauthenticated) return <LoadingBlock />;

  if (me.data && !me.data.active) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">No active workspace</p>
        <p className="mt-1 text-muted-foreground">
          Your account is signed in but has no usable workspace membership. Ask an administrator to
          add you to a workspace, then sign in again.
        </p>
      </div>
    );
  }

  const firstName = (me.data?.user.email ?? '').split('@')[0]?.split(/[.\-_]/)[0] ?? '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {firstName
              ? `Welcome back, ${firstName[0]!.toUpperCase()}${firstName.slice(1)}`
              : 'Dashboard'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {access.tenantName ?? 'Your workspace'} · {widgets.length} widget
            {widgets.length === 1 ? '' : 's'} available to you
          </p>
        </div>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : widgets.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm">
          <p className="font-medium">Nothing to show yet</p>
          <p className="mt-1 text-muted-foreground">
            Your dashboard fills in as your workspace enables modules and your access is configured.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {widgets.map((w) => (
            <div
              key={w.key}
              data-testid={`widget-${w.key}`}
              className={cn('min-w-0', SPAN_CLASS[w.span])}
            >
              <w.Component />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
