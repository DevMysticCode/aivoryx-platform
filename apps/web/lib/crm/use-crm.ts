'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CompleteFollowupRequest,
  CreateCustomFieldRequest,
  CreateFollowupRequest,
  CreateNoteRequest,
  LeadContactRequest,
  QualifyLeadRequest,
  RescheduleFollowupRequest,
} from '@aivoryx/contracts';
import * as api from '@/lib/api/crm';
import type { ListLeadsParams } from '@/lib/api/crm';

/** TanStack Query hooks for the CRM Lead surface (ADR 0031). */

export const crmKeys = {
  leads: (params: ListLeadsParams) => ['crm', 'leads', params] as const,
  lead: (id: string) => ['crm', 'lead', id] as const,
  activities: (id: string) => ['crm', 'lead', id, 'activities'] as const,
  notes: (id: string) => ['crm', 'lead', id, 'notes'] as const,
  followups: (id: string) => ['crm', 'lead', id, 'followups'] as const,
  customFields: (entity: 'lead' | 'visit' = 'lead') => ['crm', 'customFields', entity] as const,
};

export function useLeads(params: ListLeadsParams) {
  return useQuery({ queryKey: crmKeys.leads(params), queryFn: () => api.listLeads(params) });
}

export function useLead(leadId: string) {
  return useQuery({ queryKey: crmKeys.lead(leadId), queryFn: () => api.getLead(leadId) });
}

export function useActivities(leadId: string) {
  return useQuery({
    queryKey: crmKeys.activities(leadId),
    queryFn: () => api.listActivities(leadId),
  });
}

export function useNotes(leadId: string) {
  return useQuery({ queryKey: crmKeys.notes(leadId), queryFn: () => api.listNotes(leadId) });
}

export function useFollowups(leadId: string) {
  return useQuery({
    queryKey: crmKeys.followups(leadId),
    queryFn: () => api.listFollowups(leadId),
  });
}

export function useCustomFields(entity: 'lead' | 'visit' = 'lead') {
  return useQuery({
    queryKey: crmKeys.customFields(entity),
    queryFn: () => api.listCustomFields(entity),
  });
}

function useInvalidateLead(leadId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: crmKeys.lead(leadId) }),
      qc.invalidateQueries({ queryKey: crmKeys.activities(leadId) }),
      qc.invalidateQueries({ queryKey: ['crm', 'leads'] }),
    ]);
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadContactRequest) => api.createLead(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'leads'] }),
  });
}

export function useUpdateLead(leadId: string) {
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: (body: LeadContactRequest) => api.updateLead(leadId, body),
    onSuccess: invalidate,
  });
}

export function useAssignLead(leadId: string) {
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: (membershipId: string) => api.assignLead(leadId, membershipId),
    onSuccess: invalidate,
  });
}

export function useChangeLeadStatus(leadId: string) {
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: (status: string) => api.changeLeadStatus(leadId, status),
    onSuccess: invalidate,
  });
}

export function useQualifyLead(leadId: string) {
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: (body: QualifyLeadRequest) => api.qualifyLead(leadId, body),
    onSuccess: invalidate,
  });
}

export function useLogCallAttempt(leadId: string) {
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: ({ outcome, note }: { outcome: string; note?: string }) =>
      api.logCallAttempt(leadId, outcome, note),
    onSuccess: invalidate,
  });
}

export function useCreateNote(leadId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: (body: CreateNoteRequest) => api.createNote(leadId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: crmKeys.notes(leadId) });
      await invalidate();
    },
  });
}

export function useUpdateNote(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: CreateNoteRequest }) =>
      api.updateNote(leadId, noteId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.notes(leadId) }),
  });
}

export function useDeleteNote(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.deleteNote(leadId, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.notes(leadId) }),
  });
}

export function useCreateFollowup(leadId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: (body: CreateFollowupRequest) => api.createFollowup(leadId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: crmKeys.followups(leadId) });
      await invalidate();
    },
  });
}

export function useCompleteFollowup(leadId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateLead(leadId);
  return useMutation({
    mutationFn: ({ followupId, body }: { followupId: string; body: CompleteFollowupRequest }) =>
      api.completeFollowup(leadId, followupId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: crmKeys.followups(leadId) });
      await invalidate();
    },
  });
}

export function useRescheduleFollowup(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ followupId, body }: { followupId: string; body: RescheduleFollowupRequest }) =>
      api.rescheduleFollowup(leadId, followupId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.followups(leadId) }),
  });
}

export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomFieldRequest) => api.createCustomField(body),
    onSuccess: (definition) =>
      qc.invalidateQueries({
        queryKey: crmKeys.customFields(definition.entity as 'lead' | 'visit'),
      }),
  });
}
