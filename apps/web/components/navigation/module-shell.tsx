'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { useNavigation } from '@/lib/navigation/use-navigation';
import { entryMatchesPath } from '@/lib/navigation/registry';
import { Skeleton, WorkspaceUnavailable } from '@/components/admin/ui';
import { ModuleTabs } from '@/components/ui/module-tabs';

/**
 * The in-page section strip for the module the current route belongs to. It is
 * derived from the SAME registry as the sidebar (one source of truth) and is
 * shown below the desktop breakpoint only — on desktop the sidebar already lists
 * the sections, so repeating them would just be noise.
 */
export function ModuleSectionTabs() {
  const pathname = usePathname() ?? '/';
  const { entries } = useNavigation();
  const owner = entries.find((e) => e.children?.some((c) => entryMatchesPath(c, pathname)));
  const sections = owner?.children ?? [];
  if (sections.length < 2) return null;
  // the most specific section wins (an "Overview" is exact, others prefix)
  const currentKey = sections
    .filter((s) => entryMatchesPath(s, pathname))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0]?.key;
  return (
    <ModuleTabs
      className="md:hidden"
      label={`${owner!.label} sections`}
      items={sections.map((s) => ({
        href: s.href!,
        label: s.label,
        icon: s.icon,
        current: s.key === currentKey,
      }))}
    />
  );
}

/**
 * Shared chrome for every module area: enforces an active session, shows the
 * standard session / workspace-unavailable states, and renders the registry-
 * derived section strip. Replaces the per-module hand-written tab arrays.
 */
export function ModuleShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  if (me.isLoading || unauthenticated) return <Skeleton rows={4} />;

  if (me.error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm">
        <p className="font-medium text-danger">Could not load your session.</p>
        <p className="mt-1 text-muted-foreground">{(me.error as Error).message}</p>
      </div>
    );
  }

  if (!me.data?.active) {
    return (
      <WorkspaceUnavailable
        inactiveMembership={me.data?.inactiveMembership}
        memberships={me.data?.memberships}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ModuleSectionTabs />
      {children}
    </div>
  );
}
