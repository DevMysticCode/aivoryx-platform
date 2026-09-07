import type {
  PlatformModuleCatalogue,
  PlatformOverview,
  PlatformTenantDetail,
  PlatformTenantSummary,
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
