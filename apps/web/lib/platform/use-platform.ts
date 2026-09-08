'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/platform';

export const platformKeys = {
  overview: ['platform', 'overview'] as const,
  modules: ['platform', 'modules'] as const,
  tenants: ['platform', 'tenants'] as const,
  tenant: (id: string) => ['platform', 'tenant', id] as const,
};

export function usePlatformOverview() {
  return useQuery({ queryKey: platformKeys.overview, queryFn: api.getPlatformOverview });
}

export function usePlatformModules() {
  return useQuery({ queryKey: platformKeys.modules, queryFn: api.listPlatformModules });
}

export function usePlatformTenants() {
  return useQuery({ queryKey: platformKeys.tenants, queryFn: api.listPlatformTenants });
}

export function usePlatformTenant(tenantId: string) {
  return useQuery({
    queryKey: platformKeys.tenant(tenantId),
    queryFn: () => api.getPlatformTenant(tenantId),
    enabled: !!tenantId,
  });
}

export function useSetTenantModule(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { moduleKey: string; state: 'ENABLED' | 'DISABLED'; note?: string }) =>
      api.setPlatformTenantModule(tenantId, input.moduleKey, input.state, input.note),
    onSuccess: (detail) => {
      qc.setQueryData(platformKeys.tenant(tenantId), detail);
      return Promise.all([
        qc.invalidateQueries({ queryKey: platformKeys.tenants }),
        qc.invalidateQueries({ queryKey: platformKeys.overview }),
      ]);
    },
  });
}
