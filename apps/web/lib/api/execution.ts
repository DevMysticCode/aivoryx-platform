import type {
  AddChecklistItemRequest,
  AssignInstallationRequest,
  ChecklistItem,
  ChecklistTemplate,
  CompleteInstallationRequest,
  CreateDefectRequest,
  Defect,
  ExecutionAttachment,
  ExecutionView,
  FailQcRequest,
  FieldProject,
  MaterialOverrideRequest,
  Milestone,
  NetMetering,
  ProjectCompletionResult,
  QcInspectionDetail,
  StartInstallationRequest,
  ToggleChecklistItemRequest,
  UpdateDefectRequest,
  UpdateHandoverRequest,
  UpdateNetMeteringRequest,
} from '@aivoryx/contracts';
import { API_V1_PREFIX, type ApiErrorResponse } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch, ApiError } from './client';

/** EPC project execution API calls (ADR 0036). Authorization is server-side. */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ---- execution view ---------------------------------------

export const getExecution = (projectId: string) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/execution`, { cache: 'no-store' });
export const startExecution = (projectId: string) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/execution/start`, json({}));
export const listMilestones = (projectId: string) =>
  apiFetch<Milestone[]>(`/projects/${projectId}/milestones`, { cache: 'no-store' });
export const completeMilestone = (projectId: string, milestoneId: string, notes?: string) =>
  apiFetch<Milestone[]>(
    `/projects/${projectId}/milestones/${milestoneId}/complete`,
    json({ notes }),
  );
export const completeProject = (projectId: string) =>
  apiFetch<ProjectCompletionResult>(`/projects/${projectId}/complete`, json({}));

// ---- installation ---------------------------------------

export const assignInstallation = (projectId: string, b: AssignInstallationRequest) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/installations/assign`, json(b));
export const unassignInstallation = (projectId: string) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/installations/unassign`, json({}));
export const overrideMaterials = (projectId: string, b: MaterialOverrideRequest) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/installations/material-override`, json(b));
export const startInstallation = (projectId: string, b: StartInstallationRequest = {}) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/installations/start`, json(b));
export const completeInstallation = (projectId: string, b: CompleteInstallationRequest = {}) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/installations/complete`, json(b));

// ---- checklists ----------------------------------------

export const listChecklist = (projectId: string, kind?: string) =>
  apiFetch<ChecklistItem[]>(`/projects/${projectId}/checklists${qs({ kind })}`, {
    cache: 'no-store',
  });
export const addChecklistItem = (projectId: string, b: AddChecklistItemRequest) =>
  apiFetch<ChecklistItem[]>(`/projects/${projectId}/checklists`, json(b));
export const toggleChecklistItem = (
  projectId: string,
  itemId: string,
  b: ToggleChecklistItemRequest,
) => apiFetch<ExecutionView>(`/projects/${projectId}/checklists/${itemId}/toggle`, json(b));
export const removeChecklistItem = (projectId: string, itemId: string) =>
  apiFetch<void>(`/projects/${projectId}/checklists/${itemId}`, { method: 'DELETE' });

export const listChecklistTemplates = (kind?: string) =>
  apiFetch<ChecklistTemplate[]>(`/checklist-templates${qs({ kind })}`, { cache: 'no-store' });

// ---- QC -----------------------------------------------

export const createQcInspection = (projectId: string, inspectorMembershipId?: string) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/qc`, json({ inspectorMembershipId }));
export const getQcInspection = (projectId: string, inspectionId: string) =>
  apiFetch<QcInspectionDetail>(`/projects/${projectId}/qc/${inspectionId}`, { cache: 'no-store' });
export const toggleQcChecklistItem = (
  projectId: string,
  inspectionId: string,
  itemId: string,
  b: ToggleChecklistItemRequest,
) =>
  apiFetch<ChecklistItem[]>(
    `/projects/${projectId}/qc/${inspectionId}/checklist/${itemId}/toggle`,
    json(b),
  );
export const startQc = (projectId: string, inspectionId: string) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/qc/${inspectionId}/start`, json({}));
export const passQc = (projectId: string, inspectionId: string) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/qc/${inspectionId}/pass`, json({}));
export const failQc = (projectId: string, inspectionId: string, b: FailQcRequest = {}) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/qc/${inspectionId}/fail`, json(b));

// ---- defects -----------------------------------------

export const listDefects = (projectId: string) =>
  apiFetch<Defect[]>(`/projects/${projectId}/defects`, { cache: 'no-store' });
export const createDefect = (projectId: string, b: CreateDefectRequest) =>
  apiFetch<Defect>(`/projects/${projectId}/defects`, json(b));
export const updateDefect = (projectId: string, defectId: string, b: UpdateDefectRequest) =>
  apiFetch<Defect>(`/projects/${projectId}/defects/${defectId}`, json(b, 'PATCH'));

// ---- net metering + handover -------------------------

export const getNetMetering = (projectId: string) =>
  apiFetch<NetMetering>(`/projects/${projectId}/net-metering`, { cache: 'no-store' });
export const updateNetMetering = (projectId: string, b: UpdateNetMeteringRequest) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/net-metering`, json(b, 'PATCH'));
export const updateHandover = (projectId: string, b: UpdateHandoverRequest) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/handover`, json(b, 'PATCH'));
export const completeHandover = (projectId: string) =>
  apiFetch<ExecutionView>(`/projects/${projectId}/handover/complete`, json({}));

// ---- field PWA -------------------------------------

export const listFieldProjects = () =>
  apiFetch<FieldProject[]>('/field/projects', { cache: 'no-store' });
export const getFieldProject = (projectId: string) =>
  apiFetch<ExecutionView>(`/field/projects/${projectId}`, { cache: 'no-store' });

// ---- execution attachments -------------------------

export const listExecutionAttachments = (
  projectId: string,
  entityKind?: string,
  entityId?: string,
) =>
  apiFetch<ExecutionAttachment[]>(
    `/projects/${projectId}/execution/attachments${qs({ entityKind, entityId })}`,
    { cache: 'no-store' },
  );

export async function uploadExecutionAttachment(
  projectId: string,
  entityKind: string,
  entityId: string,
  file: File,
): Promise<ExecutionAttachment> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<ExecutionAttachment>(
    `/projects/${projectId}/execution/attachments${qs({ entityKind, entityId })}`,
    { method: 'POST', body: form },
  );
}

export const deleteExecutionAttachment = (projectId: string, attachmentId: string) =>
  apiFetch<void>(`/projects/${projectId}/execution/attachments/${attachmentId}`, {
    method: 'DELETE',
  });

export async function fetchExecutionAttachmentBlob(
  projectId: string,
  attachmentId: string,
): Promise<{ blob: Blob; objectUrl: string }> {
  const url = `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/projects/${projectId}/execution/attachments/${attachmentId}/download`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let body: ApiErrorResponse | undefined;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, body);
  }
  const blob = await res.blob();
  return { blob, objectUrl: URL.createObjectURL(blob) };
}
