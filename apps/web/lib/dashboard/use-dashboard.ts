'use client';

import { useMemo } from 'react';
import { DASHBOARD_WIDGETS } from './registry';
import { selectDashboardWidgets } from './select';
import type { DashboardWidget } from './types';
import { useAccess } from '@/lib/navigation/use-access';

/**
 * The widgets the current user should see — the registry filtered by tenant
 * module entitlements and the user's effective permissions (Phase 13C §3).
 * Role-awareness is emergent: a Sales user only holds `crm.*`, so only CRM
 * widgets pass; a Tenant Admin holds everything entitled, so they see the full
 * board. Nothing is a security boundary — every widget's data call is
 * authorized server-side.
 */
export function useDashboardWidgets(): { isLoading: boolean; widgets: DashboardWidget[] } {
  const access = useAccess();
  return useMemo(() => {
    if (access.isLoading || !access.activeMembershipId) {
      return { isLoading: access.isLoading, widgets: [] };
    }
    const widgets = selectDashboardWidgets(DASHBOARD_WIDGETS, {
      entitledModules: access.entitledModules,
      permissions: access.permissions,
    });
    return { isLoading: false, widgets };
  }, [access]);
}
