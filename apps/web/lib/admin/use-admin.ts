'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteMemberRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/admin';

/**
 * TanStack Query hooks for the tenant-admin surface (ADR 0030). Mutations
 * invalidate the affected queries so the UI reflects the server after every
 * change — the server stays authoritative.
 */

export const adminKeys = {
  me: ['auth', 'me'] as const,
  tenant: ['admin', 'tenant'] as const,
  members: ['admin', 'members'] as const,
  roles: ['admin', 'roles'] as const,
};

export function useMe() {
  return useQuery({ queryKey: adminKeys.me, queryFn: api.getMe, retry: false });
}

export function useTenant() {
  return useQuery({ queryKey: adminKeys.tenant, queryFn: api.getTenant });
}

export function useMembers() {
  return useQuery({ queryKey: adminKeys.members, queryFn: api.listMembers });
}

export function useRoles() {
  return useQuery({ queryKey: adminKeys.roles, queryFn: api.listRoles });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.updateTenant({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.tenant }),
  });
}

function invalidateMembers(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: adminKeys.members }),
    qc.invalidateQueries({ queryKey: adminKeys.tenant }),
  ]);
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteMemberRequest) => api.inviteMember(body),
    onSuccess: () => invalidateMembers(qc),
  });
}

export function useSetMemberStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      membershipId,
      status,
    }: {
      membershipId: string;
      status: 'active' | 'suspended';
    }) => api.updateMember(membershipId, { status }),
    onSuccess: () => invalidateMembers(qc),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => api.removeMember(membershipId),
    onSuccess: () => invalidateMembers(qc),
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, roleKey }: { membershipId: string; roleKey: string }) =>
      api.assignRole(membershipId, roleKey),
    onSuccess: () => invalidateMembers(qc),
  });
}

export function useRemoveRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, roleKey }: { membershipId: string; roleKey: string }) =>
      api.removeRole(membershipId, roleKey),
    onSuccess: () => invalidateMembers(qc),
  });
}
