import { API_V1_PREFIX } from '@aivoryx/contracts';
import type {
  ApiErrorResponse,
  AssignVisitRequest,
  CancelVisitRequest,
  CheckOutRequest,
  CreateVisitNoteRequest,
  DesignateFieldAgentRequest,
  FieldAgent,
  GeoPointRequest,
  RescheduleVisitRequest,
  ScheduleVisitRequest,
  SubmitSurveyRequest,
  SurveyFieldValue,
  Visit,
  VisitActivity,
  VisitAttachment,
  VisitListResponse,
  VisitNote,
} from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch, ApiError } from './client';

/** Field operations API calls (ADR 0033). Authorization is enforced entirely server-side. */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---- field agents ---------------------------------------------------

export const listFieldAgents = () => apiFetch<FieldAgent[]>('/field-agents', { cache: 'no-store' });

export const designateFieldAgent = (body: DesignateFieldAgentRequest) =>
  apiFetch<FieldAgent>('/field-agents', json(body));

export const deactivateFieldAgent = (membershipId: string) =>
  apiFetch<FieldAgent>(`/field-agents/${membershipId}/deactivate`, json({}));

// ---- visits -----------------------------------------------------------

export interface ListVisitsParams {
  status?: string;
  leadId?: string;
  assignedMembershipId?: string;
  today?: boolean;
  page?: number;
  pageSize?: number;
}

export function listVisits(params: ListVisitsParams = {}): Promise<VisitListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  return apiFetch<VisitListResponse>(`/visits${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
}

export const getVisit = (visitId: string) =>
  apiFetch<Visit>(`/visits/${visitId}`, { cache: 'no-store' });

export const scheduleVisit = (body: ScheduleVisitRequest) => apiFetch<Visit>('/visits', json(body));

export const assignVisit = (visitId: string, body: AssignVisitRequest) =>
  apiFetch<Visit>(`/visits/${visitId}/assign`, json(body));

export const rescheduleVisit = (visitId: string, body: RescheduleVisitRequest) =>
  apiFetch<Visit>(`/visits/${visitId}/reschedule`, json(body));

export const cancelVisit = (visitId: string, body: CancelVisitRequest = {}) =>
  apiFetch<Visit>(`/visits/${visitId}/cancel`, json(body));

export const checkInVisit = (visitId: string, body: GeoPointRequest) =>
  apiFetch<Visit>(`/visits/${visitId}/check-in`, json(body));

export const checkOutVisit = (visitId: string, body: CheckOutRequest) =>
  apiFetch<Visit>(`/visits/${visitId}/check-out`, json(body));

export const completeVisit = (visitId: string) =>
  apiFetch<Visit>(`/visits/${visitId}/complete`, json({}));

export const getVisitSurvey = (visitId: string) =>
  apiFetch<SurveyFieldValue[]>(`/visits/${visitId}/survey`, { cache: 'no-store' });

export const submitVisitSurvey = (visitId: string, body: SubmitSurveyRequest) =>
  apiFetch<Visit>(`/visits/${visitId}/survey`, json(body));

export const listVisitActivities = (visitId: string) =>
  apiFetch<VisitActivity[]>(`/visits/${visitId}/activities`, { cache: 'no-store' });

export const listVisitNotes = (visitId: string) =>
  apiFetch<VisitNote[]>(`/visits/${visitId}/notes`, { cache: 'no-store' });

export const createVisitNote = (visitId: string, body: CreateVisitNoteRequest) =>
  apiFetch<VisitNote>(`/visits/${visitId}/notes`, json(body));

export const listVisitAttachments = (visitId: string) =>
  apiFetch<VisitAttachment[]>(`/visits/${visitId}/attachments`, { cache: 'no-store' });

/** Uploads use `multipart/form-data` — never set `Content-Type` manually, the
 *  browser must generate the multipart boundary. */
export async function uploadVisitAttachment(visitId: string, file: File): Promise<VisitAttachment> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<VisitAttachment>(`/visits/${visitId}/attachments`, {
    method: 'POST',
    body: form,
  });
}

export const deleteVisitAttachment = (visitId: string, attachmentId: string) =>
  apiFetch<void>(`/visits/${visitId}/attachments/${attachmentId}`, { method: 'DELETE' });

/**
 * Fetches attachment bytes as a `Blob` through the authenticated download
 * route (never a bare `<img src>` to an API origin — that would rely on
 * cross-site cookie delivery, which is not guaranteed in production). Callers
 * should `URL.revokeObjectURL` the result when done with it.
 */
export async function fetchVisitAttachmentBlob(
  visitId: string,
  attachmentId: string,
): Promise<{ blob: Blob; objectUrl: string }> {
  const url = `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/visits/${visitId}/attachments/${attachmentId}/download`;
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
