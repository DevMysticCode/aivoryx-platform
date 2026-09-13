import type {
  CreateTenantRequest,
  CreateTenantResponse,
  Plan,
  PlatformModuleCatalogue,
  PlatformOverview,
  PlatformTenantDetail,
  PlatformTenantSummary,
  Solution,
  TenantUsage,
} from '@aivoryx/contracts';
import { apiFetch } from './client';

/**
 * Aivoryx platform-administration API (Phase 13, ADR 0042). Every route is
 * `@PlatformAdmin()` server-side — this client never carries a tenant id for
 * authorization, only as an explicit target selection on the module routes.
 */

export const getPlatformOverview = () =>
  apiFetch<PlatformOverview>('/platform/overview', { cache: 'no-store' });

export const listPlatformModules = () =>
  apiFetch<PlatformModuleCatalogue[]>('/platform/modules', { cache: 'no-store' });

export const listPlatformTenants = () =>
  apiFetch<PlatformTenantSummary[]>('/platform/tenants', { cache: 'no-store' });

export const getPlatformTenant = (tenantId: string) =>
  apiFetch<PlatformTenantDetail>(`/platform/tenants/${tenantId}`, { cache: 'no-store' });

export const setPlatformTenantModule = (
  tenantId: string,
  moduleKey: string,
  state: 'ENABLED' | 'DISABLED',
  note?: string,
) =>
  apiFetch<PlatformTenantDetail>(`/platform/tenants/${tenantId}/modules/${moduleKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, note }),
  });

// ---- Phase 14: solutions, plans, provisioning, lifecycle, usage --------

export const listSolutions = () =>
  apiFetch<Solution[]>('/platform/solutions', { cache: 'no-store' });

export const listPlans = () => apiFetch<Plan[]>('/platform/plans', { cache: 'no-store' });

export const createTenant = (body: CreateTenantRequest) =>
  apiFetch<CreateTenantResponse>('/platform/tenants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const lifecycleAction = (
  tenantId: string,
  action: 'activate' | 'suspend' | 'archive',
  note?: string,
) =>
  apiFetch<PlatformTenantDetail>(`/platform/tenants/${tenantId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });

export const activateTenant = (tenantId: string, note?: string) =>
  lifecycleAction(tenantId, 'activate', note);
export const suspendTenant = (tenantId: string, note?: string) =>
  lifecycleAction(tenantId, 'suspend', note);
export const archiveTenant = (tenantId: string, note?: string) =>
  lifecycleAction(tenantId, 'archive', note);

export const getTenantUsage = (tenantId: string) =>
  apiFetch<TenantUsage>(`/platform/tenants/${tenantId}/usage`, { cache: 'no-store' });
