import type {
  AdminRole,
  InviteMemberRequest,
  InviteMemberResponse,
  Member,
  MeResponse,
  Tenant,
  UpdateMemberRequest,
  UpdateTenantRequest,
} from '@aivoryx/contracts';
import { apiFetch } from './client';

/**
 * Tenant-administration API calls (ADR 0030). Thin typed wrappers over
 * `apiFetch`; all authorization is enforced server-side — this module never
 * decides what the user may do.
 */

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---- session ----------------------------------------------------------

export const getMe = () => apiFetch<MeResponse>('/auth/me', { cache: 'no-store' });

export const login = (email: string, password: string) =>
  apiFetch<MeResponse>('/auth/login', json({ email, password }));

export const switchTenant = (membershipId: string) =>
  apiFetch<MeResponse>('/auth/switch-tenant', json({ membershipId }));

export const logout = () => apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' });

// ---- tenant ---------------------------------------------------------

export const getTenant = () => apiFetch<Tenant>('/admin/tenant', { cache: 'no-store' });

export const updateTenant = (patch: UpdateTenantRequest) =>
  apiFetch<Tenant>('/admin/tenant', { ...json(patch), method: 'PATCH' });

// ---- members ------------------------------------------------------

export const listMembers = () => apiFetch<Member[]>('/admin/members', { cache: 'no-store' });

export const inviteMember = (body: InviteMemberRequest) =>
  apiFetch<InviteMemberResponse>('/admin/members', json(body));

export const updateMember = (membershipId: string, patch: UpdateMemberRequest) =>
  apiFetch<Member>(`/admin/members/${membershipId}`, { ...json(patch), method: 'PATCH' });

export const removeMember = (membershipId: string) =>
  apiFetch<void>(`/admin/members/${membershipId}`, { method: 'DELETE' });

export const assignRole = (membershipId: string, roleKey: string) =>
  apiFetch<Member>(`/admin/members/${membershipId}/roles`, json({ roleKey }));

export const removeRole = (membershipId: string, roleKey: string) =>
  apiFetch<Member>(`/admin/members/${membershipId}/roles/${roleKey}`, { method: 'DELETE' });

// ---- roles --------------------------------------------------------

export const listRoles = () => apiFetch<AdminRole[]>('/admin/roles', { cache: 'no-store' });
