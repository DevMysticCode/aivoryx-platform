'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTenantRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/platform';

export const platformKeys = {
  overview: ['platform', 'overview'] as const,
  modules: ['platform', 'modules'] as const,
  tenants: ['platform', 'tenants'] as const,
  tenant: (id: string) => ['platform', 'tenant', id] as const,
  solutions: ['platform', 'solutions'] as const,
  plans: ['platform', 'plans'] as const,
  usage: (id: string) => ['platform', 'tenant', id, 'usage'] as const,
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

// ---- Phase 14: solutions, plans, provisioning, lifecycle, usage --------

export function useSolutions() {
  return useQuery({ queryKey: platformKeys.solutions, queryFn: api.listSolutions });
}

export function usePlans() {
  return useQuery({ queryKey: platformKeys.plans, queryFn: api.listPlans });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTenantRequest) => api.createTenant(body),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: platformKeys.tenants }),
        qc.invalidateQueries({ queryKey: platformKeys.overview }),
      ]),
  });
}

function useLifecycleMutation(
  tenantId: string,
  fn: (tenantId: string, note?: string) => ReturnType<typeof api.activateTenant>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => fn(tenantId, note),
    onSuccess: (detail) => {
      qc.setQueryData(platformKeys.tenant(tenantId), detail);
      return Promise.all([
        qc.invalidateQueries({ queryKey: platformKeys.tenants }),
        qc.invalidateQueries({ queryKey: platformKeys.overview }),
      ]);
    },
  });
}

export const useActivateTenant = (tenantId: string) =>
  useLifecycleMutation(tenantId, api.activateTenant);
export const useSuspendTenant = (tenantId: string) =>
  useLifecycleMutation(tenantId, api.suspendTenant);
export const useArchiveTenant = (tenantId: string) =>
  useLifecycleMutation(tenantId, api.archiveTenant);

export function useTenantUsage(tenantId: string) {
  return useQuery({
    queryKey: platformKeys.usage(tenantId),
    queryFn: () => api.getTenantUsage(tenantId),
    enabled: !!tenantId,
  });
}
