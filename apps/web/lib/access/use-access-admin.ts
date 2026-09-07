'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateAccessRoleRequest, UpdateAccessRoleRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/access';

type Kind = 'profiles' | 'permission-sets';

export const accessKeys = {
  permissions: ['access', 'available-permissions'] as const,
  roles: (kind: Kind) => ['access', 'roles', kind] as const,
  effective: (membershipId: string) => ['access', 'effective', membershipId] as const,
};

export function useAvailablePermissions() {
  return useQuery({ queryKey: accessKeys.permissions, queryFn: api.listAvailablePermissions });
}

export function useAccessRoles(kind: Kind) {
  return useQuery({ queryKey: accessKeys.roles(kind), queryFn: () => api.listAccessRoles(kind) });
}

export function useEffectiveAccess(membershipId: string | null) {
  return useQuery({
    queryKey: accessKeys.effective(membershipId ?? ''),
    queryFn: () => api.getEffectiveAccess(membershipId as string),
    enabled: !!membershipId,
  });
}

function invalidateRoles(qc: ReturnType<typeof useQueryClient>, kind: Kind) {
  return qc.invalidateQueries({ queryKey: accessKeys.roles(kind) });
}

export function useCreateAccessRole(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccessRoleRequest) => api.createAccessRole(kind, body),
    onSuccess: () => invalidateRoles(qc, kind),
  });
}

export function useUpdateAccessRole(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { roleId: string; body: UpdateAccessRoleRequest }) =>
      api.updateAccessRole(kind, v.roleId, v.body),
    onSuccess: () => invalidateRoles(qc, kind),
  });
}

export function useDeleteAccessRole(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => api.deleteAccessRole(kind, roleId),
    onSuccess: () => invalidateRoles(qc, kind),
  });
}

export function useAssignProfile(membershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { roleId: string; dataScope: 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY' }) =>
      api.assignProfile(membershipId, v.roleId, v.dataScope),
    onSuccess: (data) => qc.setQueryData(accessKeys.effective(membershipId), data),
  });
}

export function useAddPermissionSet(membershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => api.addMemberPermissionSet(membershipId, roleId),
    onSuccess: (data) => qc.setQueryData(accessKeys.effective(membershipId), data),
  });
}

export function useRemovePermissionSet(membershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => api.removeMemberPermissionSet(membershipId, roleId),
    onSuccess: (data) => qc.setQueryData(accessKeys.effective(membershipId), data),
  });
}
