'use client';

import { useMemo } from 'react';
import { PLATFORM_NAV, TENANT_NAV, type NavEntry } from './registry';
import { useAccess } from './use-access';

/** Recursively keep entries the caller may see; drop empty groups. */
function filterEntries(
  entries: NavEntry[],
  can: (p: string | undefined) => boolean,
  hasModule: (m: string | undefined) => boolean,
): NavEntry[] {
  const out: NavEntry[] = [];
  for (const entry of entries) {
    if (!hasModule(entry.module)) continue;
    const children = entry.children ? filterEntries(entry.children, can, hasModule) : undefined;
    const selfVisible = can(entry.permission) && (entry.href !== undefined || !entry.children);
    if (entry.children) {
      if (children && children.length > 0) out.push({ ...entry, children });
      continue;
    }
    if (selfVisible) out.push(entry);
  }
  return out.sort((a, b) => a.order - b.order);
}

export interface ShellNavigation {
  isLoading: boolean;
  /** true when the platform-admin shell should render instead of the tenant shell */
  platformMode: boolean;
  entries: NavEntry[];
}

/**
 * The navigation the current shell should render — the registry (ADR 0042 §8)
 * filtered by platform role, tenant entitlements and effective permissions.
 * A platform admin with no active workspace gets the platform navigation.
 */
export function useNavigation(): ShellNavigation {
  const access = useAccess();
  return useMemo(() => {
    if (access.isPlatformAdmin && !access.activeMembershipId) {
      return { isLoading: access.isLoading, platformMode: true, entries: PLATFORM_NAV };
    }
    return {
      isLoading: access.isLoading,
      platformMode: false,
      entries: filterEntries(TENANT_NAV, access.can, access.hasModule),
    };
  }, [access]);
}
