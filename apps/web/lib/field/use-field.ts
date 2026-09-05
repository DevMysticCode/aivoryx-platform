'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignVisitRequest,
  CancelVisitRequest,
  CheckOutRequest,
  CreateVisitNoteRequest,
  DesignateFieldAgentRequest,
  GeoPointRequest,
  RescheduleVisitRequest,
  ScheduleVisitRequest,
  SubmitSurveyRequest,
} from '@aivoryx/contracts';
import * as api from '@/lib/api/field';
import type { ListVisitsParams } from '@/lib/api/field';

/** TanStack Query hooks for field operations — visits, GPS, survey, attachments (ADR 0033). */

export const fieldKeys = {
  agents: ['field', 'agents'] as const,
  visits: (params: ListVisitsParams) => ['field', 'visits', params] as const,
  visit: (id: string) => ['field', 'visit', id] as const,
  activities: (id: string) => ['field', 'visit', id, 'activities'] as const,
  notes: (id: string) => ['field', 'visit', id, 'notes'] as const,
  survey: (id: string) => ['field', 'visit', id, 'survey'] as const,
  attachments: (id: string) => ['field', 'visit', id, 'attachments'] as const,
};

// ---- field agents ---------------------------------------------------

export function useFieldAgents() {
  return useQuery({ queryKey: fieldKeys.agents, queryFn: api.listFieldAgents });
}

export function useDesignateFieldAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DesignateFieldAgentRequest) => api.designateFieldAgent(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: fieldKeys.agents }),
  });
}

export function useDeactivateFieldAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => api.deactivateFieldAgent(membershipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: fieldKeys.agents }),
  });
}

// ---- visits -----------------------------------------------------------

export function useVisits(params: ListVisitsParams) {
  return useQuery({ queryKey: fieldKeys.visits(params), queryFn: () => api.listVisits(params) });
}

export function useVisit(visitId: string) {
  return useQuery({ queryKey: fieldKeys.visit(visitId), queryFn: () => api.getVisit(visitId) });
}

export function useVisitActivities(visitId: string) {
  return useQuery({
    queryKey: fieldKeys.activities(visitId),
    queryFn: () => api.listVisitActivities(visitId),
  });
}

export function useVisitNotes(visitId: string) {
  return useQuery({
    queryKey: fieldKeys.notes(visitId),
    queryFn: () => api.listVisitNotes(visitId),
  });
}

export function useVisitSurvey(visitId: string) {
  return useQuery({
    queryKey: fieldKeys.survey(visitId),
    queryFn: () => api.getVisitSurvey(visitId),
  });
}

export function useVisitAttachments(visitId: string) {
  return useQuery({
    queryKey: fieldKeys.attachments(visitId),
    queryFn: () => api.listVisitAttachments(visitId),
  });
}

function useInvalidateVisit(visitId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: fieldKeys.visit(visitId) }),
      qc.invalidateQueries({ queryKey: fieldKeys.activities(visitId) }),
      qc.invalidateQueries({ queryKey: ['field', 'visits'] }),
    ]);
}

export function useScheduleVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduleVisitRequest) => api.scheduleVisit(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['field', 'visits'] }),
  });
}

export function useAssignVisit(visitId: string) {
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (body: AssignVisitRequest) => api.assignVisit(visitId, body),
    onSuccess: invalidate,
  });
}

export function useRescheduleVisit(visitId: string) {
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (body: RescheduleVisitRequest) => api.rescheduleVisit(visitId, body),
    onSuccess: invalidate,
  });
}

export function useCancelVisit(visitId: string) {
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (body: CancelVisitRequest = {}) => api.cancelVisit(visitId, body),
    onSuccess: invalidate,
  });
}

export function useCheckInVisit(visitId: string) {
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (body: GeoPointRequest) => api.checkInVisit(visitId, body),
    onSuccess: invalidate,
  });
}

export function useCheckOutVisit(visitId: string) {
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (body: CheckOutRequest) => api.checkOutVisit(visitId, body),
    onSuccess: invalidate,
  });
}

export function useCompleteVisit(visitId: string) {
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: () => api.completeVisit(visitId),
    onSuccess: invalidate,
  });
}

export function useSubmitVisitSurvey(visitId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (body: SubmitSurveyRequest) => api.submitVisitSurvey(visitId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: fieldKeys.survey(visitId) });
      await invalidate();
    },
  });
}

export function useCreateVisitNote(visitId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (body: CreateVisitNoteRequest) => api.createVisitNote(visitId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: fieldKeys.notes(visitId) });
      await invalidate();
    },
  });
}

export function useUploadVisitAttachment(visitId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateVisit(visitId);
  return useMutation({
    mutationFn: (file: File) => api.uploadVisitAttachment(visitId, file),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: fieldKeys.attachments(visitId) });
      await invalidate();
    },
  });
}

export function useDeleteVisitAttachment(visitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteVisitAttachment(visitId, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: fieldKeys.attachments(visitId) }),
  });
}
