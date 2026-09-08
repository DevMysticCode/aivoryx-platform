'use client';

import { useMemo } from 'react';
import type { ModuleKey } from '@aivoryx/shared';
import { useMe } from '@/lib/admin/use-admin';

/**
 * The single client-side view of "what can I do" — derived entirely from
 * `/auth/me` (the server is authoritative, ADR 0042 §58). Everything in the
 * shell (navigation, command palette, dashboard widgets, route guards) asks
 * these predicates rather than re-deriving authorization.
 */
export interface AccessView {
  isLoading: boolean;
  isAuthenticated: boolean;
  isPlatformAdmin: boolean;
  /** null until a workspace is active */
  activeMembershipId: string | null;
  tenantName: string | null;
  entitledModules: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  /** the user holds this effective permission (already entitlement-filtered) */
  can: (permission: string | undefined) => boolean;
  /** the active workspace is entitled to this module */
  hasModule: (module: ModuleKey | string | undefined) => boolean;
}

export function useAccess(): AccessView {
  const me = useMe();
  return useMemo(() => {
    const active = me.data?.active ?? null;
    const entitledModules = new Set(active?.entitledModules ?? []);
    const permissions = new Set(active?.permissions ?? []);
    return {
      isLoading: me.isLoading,
      isAuthenticated: !!me.data?.user,
      isPlatformAdmin: !!me.data?.isPlatformAdmin,
      activeMembershipId: active?.membership.id ?? null,
      tenantName: active?.membership.tenantName ?? active?.branding?.displayName ?? null,
      entitledModules,
      permissions,
      can: (permission) => permission === undefined || permissions.has(permission),
      hasModule: (module) => module === undefined || entitledModules.has(module),
    };
  }, [me.data, me.isLoading]);
}
