'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useMutationWithFeedback } from '@/lib/api/use-mutation-with-feedback';

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
    start: useMutationWithFeedback({
      mutationFn: () => api.startExecution(projectId),
      successMessage: 'Execution started',
      ...opt,
    }),
    completeMilestone: useMutationWithFeedback({
      mutationFn: ({ milestoneId, notes }: { milestoneId: string; notes?: string }) =>
        api.completeMilestone(projectId, milestoneId, notes),
      successMessage: 'Milestone marked done',
      ...opt,
    }),
    completeProject: useMutationWithFeedback({
      mutationFn: () => api.completeProject(projectId),
      successMessage: 'Project marked complete',
      ...opt,
    }),
    assign: useMutationWithFeedback({
      mutationFn: (b: AssignInstallationRequest) => api.assignInstallation(projectId, b),
      successMessage: 'Installer assigned',
      ...opt,
    }),
    unassign: useMutationWithFeedback({
      mutationFn: () => api.unassignInstallation(projectId),
      successMessage: 'Installer unassigned',
      ...opt,
    }),
    override: useMutationWithFeedback({
      mutationFn: (b: MaterialOverrideRequest) => api.overrideMaterials(projectId, b),
      successMessage: 'Material readiness override applied',
      ...opt,
    }),
    startInstallation: useMutationWithFeedback({
      mutationFn: (b: StartInstallationRequest = {}) => api.startInstallation(projectId, b),
      successMessage: 'Installation started',
      ...opt,
    }),
    completeInstallation: useMutationWithFeedback({
      mutationFn: (b: CompleteInstallationRequest = {}) => api.completeInstallation(projectId, b),
      successMessage: 'Installation marked complete',
      ...opt,
    }),
    addChecklistItem: useMutationWithFeedback({
      mutationFn: (b: AddChecklistItemRequest) => api.addChecklistItem(projectId, b),
      successMessage: 'Checklist item added',
      ...opt,
    }),
    toggleChecklistItem: useMutationWithFeedback({
      mutationFn: ({ itemId, ...b }: ToggleChecklistItemRequest & { itemId: string }) =>
        api.toggleChecklistItem(projectId, itemId, b),
      successMessage: 'Checklist item updated',
      ...opt,
    }),
    removeChecklistItem: useMutationWithFeedback({
      mutationFn: (itemId: string) => api.removeChecklistItem(projectId, itemId),
      successMessage: 'Checklist item removed',
      ...opt,
    }),
    createQc: useMutationWithFeedback({
      mutationFn: (inspectorMembershipId?: string) =>
        api.createQcInspection(projectId, inspectorMembershipId),
      successMessage: 'QC inspection opened',
      ...opt,
    }),
    toggleQcItem: useMutationWithFeedback({
      mutationFn: ({
        inspectionId,
        itemId,
        ...b
      }: ToggleChecklistItemRequest & { inspectionId: string; itemId: string }) =>
        api.toggleQcChecklistItem(projectId, inspectionId, itemId, b),
      successMessage: 'QC checklist updated',
      ...opt,
    }),
    startQc: useMutationWithFeedback({
      mutationFn: (inspectionId: string) => api.startQc(projectId, inspectionId),
      successMessage: 'QC inspection started',
      ...opt,
    }),
    passQc: useMutationWithFeedback({
      mutationFn: (inspectionId: string) => api.passQc(projectId, inspectionId),
      successMessage: 'QC passed',
      ...opt,
    }),
    failQc: useMutationWithFeedback({
      mutationFn: ({ inspectionId, resultNote }: { inspectionId: string; resultNote?: string }) =>
        api.failQc(projectId, inspectionId, { resultNote }),
      successMessage: 'QC failed',
      ...opt,
    }),
    createDefect: useMutationWithFeedback({
      mutationFn: (b: CreateDefectRequest) => api.createDefect(projectId, b),
      successMessage: 'Defect raised',
      ...opt,
    }),
    updateDefect: useMutationWithFeedback({
      mutationFn: ({ defectId, ...b }: UpdateDefectRequest & { defectId: string }) =>
        api.updateDefect(projectId, defectId, b),
      successMessage: (_data, vars) =>
        vars.status
          ? `Defect marked ${vars.status.replace(/_/g, ' ').toLowerCase()}`
          : 'Defect updated',
      ...opt,
    }),
    updateNetMetering: useMutationWithFeedback({
      mutationFn: (b: UpdateNetMeteringRequest) => api.updateNetMetering(projectId, b),
      successMessage: 'Net metering updated',
      ...opt,
    }),
    updateHandover: useMutationWithFeedback({
      mutationFn: (b: UpdateHandoverRequest) => api.updateHandover(projectId, b),
      successMessage: 'Handover acknowledgement saved',
      ...opt,
    }),
    completeHandover: useMutationWithFeedback({
      mutationFn: () => api.completeHandover(projectId),
      successMessage: 'Handover completed',
      ...opt,
    }),
  };
}

export function useUploadExecutionAttachment(projectId: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: ({
      entityKind,
      entityId,
      file,
    }: {
      entityKind: string;
      entityId: string;
      file: File;
    }) => api.uploadExecutionAttachment(projectId, entityKind, entityId, file),
    successMessage: 'File uploaded',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution', 'attachments', projectId] }),
  });
}

export function useDeleteExecutionAttachment(projectId: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (attachmentId: string) => api.deleteExecutionAttachment(projectId, attachmentId),
    successMessage: 'File deleted',
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution', 'attachments', projectId] }),
  });
}
