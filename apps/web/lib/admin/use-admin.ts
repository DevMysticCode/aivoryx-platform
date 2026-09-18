'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteMemberRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/admin';
import { useMutationWithFeedback } from '@/lib/api/use-mutation-with-feedback';

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
  return useMutationWithFeedback({
    mutationFn: (name: string) => api.updateTenant({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.tenant }),
    successMessage: 'Workspace name updated',
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
  return useMutationWithFeedback({
    mutationFn: (body: InviteMemberRequest) => api.inviteMember(body),
    onSuccess: () => invalidateMembers(qc),
  });
}

/**
 * Re-invite an existing `invited` membership by email. The backend treats
 * this identically to a fresh invite (`invitation.service.ts` `create`):
 * it silently revokes any prior pending invitation and issues a new one, so
 * this is the supported "resend" path. Kept separate from `useInviteMember`
 * because the two calls need different success feedback: the initial invite
 * shows its own one-time token handoff panel (no email provider is
 * configured), while a resend has nothing new to hand off and just needs a
 * toast.
 */
export function useResendInvite() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (body: InviteMemberRequest) => api.inviteMember(body),
    onSuccess: () => invalidateMembers(qc),
    successMessage: 'Invitation resent',
  });
}

export function useSetMemberStatus() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: ({
      membershipId,
      status,
    }: {
      membershipId: string;
      status: 'active' | 'suspended';
    }) => api.updateMember(membershipId, { status }),
    onSuccess: () => invalidateMembers(qc),
    successMessage: (_data, variables) =>
      variables.status === 'active' ? 'Member reactivated' : 'Member suspended',
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (membershipId: string) => api.removeMember(membershipId),
    onSuccess: () => invalidateMembers(qc),
    successMessage: 'Member removed',
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: ({ membershipId, roleKey }: { membershipId: string; roleKey: string }) =>
      api.assignRole(membershipId, roleKey),
    onSuccess: () => invalidateMembers(qc),
    successMessage: 'Role assigned',
  });
}

export function useRemoveRole() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: ({ membershipId, roleKey }: { membershipId: string; roleKey: string }) =>
      api.removeRole(membershipId, roleKey),
    onSuccess: () => invalidateMembers(qc),
    successMessage: 'Role removed',
  });
}
