import type {
  CompleteFollowupRequest,
  CreateCustomFieldRequest,
  CreateFollowupRequest,
  CreateNoteRequest,
  CustomFieldDefinition,
  Followup,
  Lead,
  LeadActivity,
  LeadContactRequest,
  LeadListResponse,
  Note,
  QualifyLeadRequest,
  RescheduleFollowupRequest,
} from '@aivoryx/contracts';
import { apiFetch } from './client';

/** CRM Lead API calls (ADR 0031). Authorization is enforced entirely server-side. */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface ListLeadsParams {
  status?: string;
  sourceId?: string;
  assignedMembershipId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function listLeads(params: ListLeadsParams = {}): Promise<LeadListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  return apiFetch<LeadListResponse>(`/crm/leads${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
}

export const getLead = (leadId: string) =>
  apiFetch<Lead>(`/crm/leads/${leadId}`, { cache: 'no-store' });

export const createLead = (body: LeadContactRequest) => apiFetch<Lead>('/crm/leads', json(body));

export const updateLead = (leadId: string, body: LeadContactRequest) =>
  apiFetch<Lead>(`/crm/leads/${leadId}`, json(body, 'PATCH'));

export const assignLead = (leadId: string, membershipId: string) =>
  apiFetch<Lead>(`/crm/leads/${leadId}/assign`, json({ membershipId }));

export const changeLeadStatus = (leadId: string, status: string) =>
  apiFetch<Lead>(`/crm/leads/${leadId}/status`, json({ status }));

export const qualifyLead = (leadId: string, body: QualifyLeadRequest) =>
  apiFetch<Lead>(`/crm/leads/${leadId}/qualify`, json(body));

export const logCallAttempt = (leadId: string, outcome: string, note?: string) =>
  apiFetch<Lead>(`/crm/leads/${leadId}/call-attempts`, json({ outcome, note }));

export const listActivities = (leadId: string) =>
  apiFetch<LeadActivity[]>(`/crm/leads/${leadId}/activities`, { cache: 'no-store' });

export const listNotes = (leadId: string) =>
  apiFetch<Note[]>(`/crm/leads/${leadId}/notes`, { cache: 'no-store' });

export const createNote = (leadId: string, body: CreateNoteRequest) =>
  apiFetch<Note>(`/crm/leads/${leadId}/notes`, json(body));

export const updateNote = (leadId: string, noteId: string, body: CreateNoteRequest) =>
  apiFetch<Note>(`/crm/leads/${leadId}/notes/${noteId}`, json(body, 'PATCH'));

export const deleteNote = (leadId: string, noteId: string) =>
  apiFetch<void>(`/crm/leads/${leadId}/notes/${noteId}`, { method: 'DELETE' });

export const listFollowups = (leadId: string) =>
  apiFetch<Followup[]>(`/crm/leads/${leadId}/followups`, { cache: 'no-store' });

export const createFollowup = (leadId: string, body: CreateFollowupRequest) =>
  apiFetch<Followup>(`/crm/leads/${leadId}/followups`, json(body));

export const completeFollowup = (
  leadId: string,
  followupId: string,
  body: CompleteFollowupRequest,
) => apiFetch<Followup>(`/crm/leads/${leadId}/followups/${followupId}/complete`, json(body));

export const rescheduleFollowup = (
  leadId: string,
  followupId: string,
  body: RescheduleFollowupRequest,
) => apiFetch<Followup>(`/crm/leads/${leadId}/followups/${followupId}/reschedule`, json(body));

export const listCustomFields = () =>
  apiFetch<CustomFieldDefinition[]>('/crm/custom-fields', { cache: 'no-store' });

export const createCustomField = (body: CreateCustomFieldRequest) =>
  apiFetch<CustomFieldDefinition>('/crm/custom-fields', json(body));
