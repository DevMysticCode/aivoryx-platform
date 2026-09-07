import type {
  AccessRole,
  AvailablePermission,
  CreateAccessRoleRequest,
  EffectiveAccess,
  UpdateAccessRoleRequest,
} from '@aivoryx/contracts';
import { apiFetch } from './client';

/**
 * Tenant-side access configuration (Phase 13, ADR 0042): Profiles, Permission
 * Sets, and per-member effective access. Reuses the `roles.*` permission family
 * server-side; every offered permission is filtered to entitled modules.
 */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

type Kind = 'profiles' | 'permission-sets';

export const listAvailablePermissions = () =>
  apiFetch<AvailablePermission[]>('/admin/access/available-permissions', { cache: 'no-store' });

export const listAccessRoles = (kind: Kind) =>
  apiFetch<AccessRole[]>(`/admin/${kind}`, { cache: 'no-store' });

export const createAccessRole = (kind: Kind, body: CreateAccessRoleRequest) =>
  apiFetch<AccessRole>(`/admin/${kind}`, json(body));

export const updateAccessRole = (kind: Kind, roleId: string, body: UpdateAccessRoleRequest) =>
  apiFetch<AccessRole>(`/admin/${kind}/${roleId}`, json(body, 'PATCH'));

export const deleteAccessRole = (kind: Kind, roleId: string) =>
  apiFetch<void>(`/admin/${kind}/${roleId}`, { method: 'DELETE' });

export const getEffectiveAccess = (membershipId: string) =>
  apiFetch<EffectiveAccess>(`/admin/access/${membershipId}`, { cache: 'no-store' });

export const assignProfile = (
  membershipId: string,
  roleId: string,
  dataScope: 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY',
) =>
  apiFetch<EffectiveAccess>(`/admin/access/${membershipId}/profile`, json({ roleId, dataScope }));

export const addMemberPermissionSet = (membershipId: string, roleId: string) =>
  apiFetch<EffectiveAccess>(`/admin/access/${membershipId}/permission-sets`, json({ roleId }));

export const removeMemberPermissionSet = (membershipId: string, roleId: string) =>
  apiFetch<EffectiveAccess>(`/admin/access/${membershipId}/permission-sets/${roleId}`, {
    method: 'DELETE',
  });
