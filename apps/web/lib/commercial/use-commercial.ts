'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptQuotationRequest,
  CreateCustomerRequest,
  CreateQuotationRequest,
  ReviseQuotationRequest,
  UpdateCustomerRequest,
  UpdateQuotationRequest,
} from '@aivoryx/contracts';
import * as api from '@/lib/api/commercial';
import type { ListCustomersParams, ListQuotationsParams } from '@/lib/api/commercial';
import { useMutationWithFeedback } from '@/lib/api/use-mutation-with-feedback';

/** TanStack Query hooks for customers & quotations (ADR 0035). */

export const commercialKeys = {
  customers: (p: ListCustomersParams) => ['commercial', 'customers', p] as const,
  customer: (id: string) => ['commercial', 'customer', id] as const,
  quotations: (p: ListQuotationsParams) => ['commercial', 'quotations', p] as const,
  quotation: (id: string) => ['commercial', 'quotation', id] as const,
  quotationActivities: (id: string) => ['commercial', 'quotation', id, 'activities'] as const,
  quotationAttachments: (id: string) => ['commercial', 'quotation', id, 'attachments'] as const,
  leadQuotations: (leadId: string) => ['commercial', 'lead', leadId, 'quotations'] as const,
};

// ---- customers ----------------------------------------------

export const useCustomers = (p: ListCustomersParams = {}) =>
  useQuery({ queryKey: commercialKeys.customers(p), queryFn: () => api.listCustomers(p) });
export const useCustomer = (id: string) =>
  useQuery({
    queryKey: commercialKeys.customer(id),
    queryFn: () => api.getCustomer(id),
    enabled: !!id,
  });

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (b: CreateCustomerRequest) => api.createCustomer(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commercial', 'customers'] }),
    successMessage: 'Customer created',
  });
}
export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (b: UpdateCustomerRequest) => api.updateCustomer(id, b),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: commercialKeys.customer(id) }),
        qc.invalidateQueries({ queryKey: ['commercial', 'customers'] }),
      ]),
    successMessage: 'Customer updated',
  });
}

// ---- quotations ------------------------------------------

export const useQuotations = (p: ListQuotationsParams = {}, opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: commercialKeys.quotations(p),
    queryFn: () => api.listQuotations(p),
    enabled: opts.enabled ?? true,
  });
export const useQuotation = (id: string) =>
  useQuery({
    queryKey: commercialKeys.quotation(id),
    queryFn: () => api.getQuotation(id),
    enabled: !!id,
  });
export const useQuotationActivities = (id: string) =>
  useQuery({
    queryKey: commercialKeys.quotationActivities(id),
    queryFn: () => api.listQuotationActivities(id),
    enabled: !!id,
  });
export const useQuotationAttachments = (id: string) =>
  useQuery({
    queryKey: commercialKeys.quotationAttachments(id),
    queryFn: () => api.listQuotationAttachments(id),
    enabled: !!id,
  });
export const useLeadQuotations = (leadId: string, options?: { enabled?: boolean }) =>
  useQuery({
    queryKey: commercialKeys.leadQuotations(leadId),
    queryFn: () => api.listLeadQuotations(leadId),
    enabled: !!leadId && (options?.enabled ?? true),
  });

function useInvalidateQuotation(id: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: commercialKeys.quotation(id) }),
      qc.invalidateQueries({ queryKey: commercialKeys.quotationActivities(id) }),
      qc.invalidateQueries({ queryKey: ['commercial', 'quotations'] }),
      qc.invalidateQueries({ queryKey: ['commercial', 'lead'] }),
      qc.invalidateQueries({ queryKey: ['commercial', 'customers'] }),
      // booking touches projects + the CRM lead
      qc.invalidateQueries({ queryKey: ['supply', 'projects'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'project'] }),
      qc.invalidateQueries({ queryKey: ['crm', 'lead'] }),
    ]);
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateQuotationRequest) => api.createQuotation(b),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['commercial', 'quotations'] }),
        qc.invalidateQueries({ queryKey: ['commercial', 'lead'] }),
      ]),
  });
}
export function useUpdateQuotation(id: string) {
  const invalidate = useInvalidateQuotation(id);
  return useMutationWithFeedback({
    mutationFn: (b: UpdateQuotationRequest) => api.updateQuotation(id, b),
    onSuccess: invalidate,
    successMessage: 'Quotation updated',
  });
}
export function useQuotationActions(id: string) {
  const invalidate = useInvalidateQuotation(id);
  return {
    revise: useMutationWithFeedback({
      mutationFn: (b: ReviseQuotationRequest = {}) => api.reviseQuotation(id, b),
      onSuccess: invalidate,
      successMessage: 'Quotation revised',
    }),
    send: useMutationWithFeedback({
      mutationFn: () => api.sendQuotation(id),
      onSuccess: invalidate,
      successMessage: 'Quotation sent',
    }),
    accept: useMutationWithFeedback({
      mutationFn: (b: AcceptQuotationRequest = {}) => api.acceptQuotation(id, b),
      onSuccess: invalidate,
      successMessage: 'Quotation acceptance recorded',
    }),
    cancel: useMutationWithFeedback({
      mutationFn: () => api.cancelQuotation(id),
      onSuccess: invalidate,
      successMessage: 'Quotation cancelled',
    }),
    expire: useMutationWithFeedback({
      mutationFn: () => api.expireQuotation(id),
      onSuccess: invalidate,
      successMessage: 'Quotation expired',
    }),
    book: useMutationWithFeedback({
      mutationFn: () => api.bookQuotation(id),
      onSuccess: invalidate,
      successMessage: 'Quotation booked',
    }),
  };
}

export function useUploadQuotationAttachment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadQuotationAttachment(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: commercialKeys.quotationAttachments(id) }),
  });
}
export function useDeleteQuotationAttachment(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (attachmentId: string) => api.deleteQuotationAttachment(id, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: commercialKeys.quotationAttachments(id) }),
    successMessage: 'Attachment deleted',
  });
}

export function useQuotationPipelineSummary(enabled: boolean) {
  return useQuery({
    queryKey: ['commercial', 'pipeline-summary'],
    queryFn: api.quotationPipelineSummary,
    enabled,
    retry: false,
  });
}
