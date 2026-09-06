'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddChecklistItemRequest,
  AssignInstallationRequest,
  CompleteInstallationRequest,
  CreateDefectRequest,
  MaterialOverrideRequest,
  StartInstallationRequest,
  ToggleChecklistItemRequest,
  UpdateDefectRequest,
  UpdateHandoverRequest,
  UpdateNetMeteringRequest,
} from '@aivoryx/contracts';
import * as api from '@/lib/api/execution';

/** TanStack Query hooks for EPC project execution (ADR 0036). */

export const executionKeys = {
  view: (projectId: string) => ['execution', 'view', projectId] as const,
  qc: (projectId: string, inspectionId: string) =>
    ['execution', 'qc', projectId, inspectionId] as const,
  fieldProjects: ['execution', 'field-projects'] as const,
  fieldProject: (projectId: string) => ['execution', 'field-project', projectId] as const,
  attachments: (projectId: string, entityKind?: string, entityId?: string) =>
    ['execution', 'attachments', projectId, entityKind ?? '', entityId ?? ''] as const,
};

export const useExecution = (projectId: string, opts: { field?: boolean } = {}) =>
  useQuery({
    queryKey: opts.field ? executionKeys.fieldProject(projectId) : executionKeys.view(projectId),
    queryFn: () => (opts.field ? api.getFieldProject(projectId) : api.getExecution(projectId)),
    enabled: !!projectId,
  });

export const useFieldProjects = () =>
  useQuery({ queryKey: executionKeys.fieldProjects, queryFn: api.listFieldProjects });

export const useQcInspection = (projectId: string, inspectionId: string) =>
  useQuery({
    queryKey: executionKeys.qc(projectId, inspectionId),
    queryFn: () => api.getQcInspection(projectId, inspectionId),
    enabled: !!projectId && !!inspectionId,
  });

export const useExecutionAttachments = (
  projectId: string,
  entityKind?: string,
  entityId?: string,
) =>
  useQuery({
    queryKey: executionKeys.attachments(projectId, entityKind, entityId),
    queryFn: () => api.listExecutionAttachments(projectId, entityKind, entityId),
    enabled: !!projectId,
  });

function useInvalidate(projectId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: executionKeys.view(projectId) }),
      qc.invalidateQueries({ queryKey: executionKeys.fieldProject(projectId) }),
      qc.invalidateQueries({ queryKey: executionKeys.fieldProjects }),
      qc.invalidateQueries({ queryKey: ['execution', 'qc', projectId] }),
      qc.invalidateQueries({ queryKey: ['supply', 'project', projectId] }),
      qc.invalidateQueries({ queryKey: ['crm', 'lead'] }),
    ]);
}

/** All the execution write actions for one project. */
export function useExecutionActions(projectId: string) {
  const invalidate = useInvalidate(projectId);
  const opt = { onSuccess: invalidate };

  return {
    start: useMutation({ mutationFn: () => api.startExecution(projectId), ...opt }),
    completeMilestone: useMutation({
      mutationFn: ({ milestoneId, notes }: { milestoneId: string; notes?: string }) =>
        api.completeMilestone(projectId, milestoneId, notes),
      ...opt,
    }),
    completeProject: useMutation({ mutationFn: () => api.completeProject(projectId), ...opt }),
    assign: useMutation({
      mutationFn: (b: AssignInstallationRequest) => api.assignInstallation(projectId, b),
      ...opt,
    }),
    unassign: useMutation({ mutationFn: () => api.unassignInstallation(projectId), ...opt }),
    override: useMutation({
      mutationFn: (b: MaterialOverrideRequest) => api.overrideMaterials(projectId, b),
      ...opt,
    }),
    startInstallation: useMutation({
      mutationFn: (b: StartInstallationRequest = {}) => api.startInstallation(projectId, b),
      ...opt,
    }),
    completeInstallation: useMutation({
      mutationFn: (b: CompleteInstallationRequest = {}) => api.completeInstallation(projectId, b),
      ...opt,
    }),
    addChecklistItem: useMutation({
      mutationFn: (b: AddChecklistItemRequest) => api.addChecklistItem(projectId, b),
      ...opt,
    }),
    toggleChecklistItem: useMutation({
      mutationFn: ({ itemId, ...b }: ToggleChecklistItemRequest & { itemId: string }) =>
        api.toggleChecklistItem(projectId, itemId, b),
      ...opt,
    }),
    removeChecklistItem: useMutation({
      mutationFn: (itemId: string) => api.removeChecklistItem(projectId, itemId),
      ...opt,
    }),
    createQc: useMutation({
      mutationFn: (inspectorMembershipId?: string) =>
        api.createQcInspection(projectId, inspectorMembershipId),
      ...opt,
    }),
    toggleQcItem: useMutation({
      mutationFn: ({
        inspectionId,
        itemId,
        ...b
      }: ToggleChecklistItemRequest & { inspectionId: string; itemId: string }) =>
        api.toggleQcChecklistItem(projectId, inspectionId, itemId, b),
      ...opt,
    }),
    startQc: useMutation({
      mutationFn: (inspectionId: string) => api.startQc(projectId, inspectionId),
      ...opt,
    }),
    passQc: useMutation({
      mutationFn: (inspectionId: string) => api.passQc(projectId, inspectionId),
      ...opt,
    }),
    failQc: useMutation({
      mutationFn: ({ inspectionId, resultNote }: { inspectionId: string; resultNote?: string }) =>
        api.failQc(projectId, inspectionId, { resultNote }),
      ...opt,
    }),
    createDefect: useMutation({
      mutationFn: (b: CreateDefectRequest) => api.createDefect(projectId, b),
      ...opt,
    }),
    updateDefect: useMutation({
      mutationFn: ({ defectId, ...b }: UpdateDefectRequest & { defectId: string }) =>
        api.updateDefect(projectId, defectId, b),
      ...opt,
    }),
    updateNetMetering: useMutation({
      mutationFn: (b: UpdateNetMeteringRequest) => api.updateNetMetering(projectId, b),
      ...opt,
    }),
    updateHandover: useMutation({
      mutationFn: (b: UpdateHandoverRequest) => api.updateHandover(projectId, b),
      ...opt,
    }),
    completeHandover: useMutation({ mutationFn: () => api.completeHandover(projectId), ...opt }),
  };
}

export function useUploadExecutionAttachment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entityKind,
      entityId,
      file,
    }: {
      entityKind: string;
      entityId: string;
      file: File;
    }) => api.uploadExecutionAttachment(projectId, entityKind, entityId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution', 'attachments', projectId] }),
  });
}

export function useDeleteExecutionAttachment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteExecutionAttachment(projectId, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution', 'attachments', projectId] }),
  });
}
