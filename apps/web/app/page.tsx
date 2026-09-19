'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@aivoryx/ui';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { useAccess } from '@/lib/navigation/use-access';
import { useDashboardWidgets } from '@/lib/dashboard/use-dashboard';
import { groupWidgetsBySection } from '@/lib/dashboard/select';
import { LoadingBlock } from '@/components/ui/kit';
import { EmptyState, WorkspaceUnavailable } from '@/components/admin/ui';
import { OnboardingCard } from '@/components/onboarding-card';

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
      <WorkspaceUnavailable
        inactiveMembership={me.data.inactiveMembership}
        memberships={me.data.memberships}
      />
    );
  }

  const firstName = (me.data?.user.email ?? '').split('@')[0]?.split(/[.\-_]/)[0] ?? '';

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          {firstName
            ? `Welcome back, ${firstName[0]!.toUpperCase()}${firstName.slice(1)}`
            : 'Dashboard'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {access.tenantName ?? 'Your workspace'} · {today}
        </p>
      </div>

      <OnboardingCard />

      {isLoading ? (
        <LoadingBlock />
      ) : widgets.length === 0 ? (
        <EmptyState title="Nothing to show yet">
          Your dashboard fills in as your company enables modules and your access is configured. Ask
          a workspace administrator which areas you should have.
        </EmptyState>
      ) : (
        <div className="space-y-7">
          {groupWidgetsBySection(widgets).map((group, i) => (
            <section
              key={group.section ?? `_${i}`}
              aria-label={group.section}
              className="space-y-3"
            >
              {group.section ? (
                <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">
                  {group.section}
                </h2>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                {group.widgets.map((w) => (
                  <div
                    key={w.key}
                    data-testid={`widget-${w.key}`}
                    className={cn('min-w-0', SPAN_CLASS[w.span])}
                  >
                    <w.Component />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
