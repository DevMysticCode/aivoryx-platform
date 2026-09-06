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
  return useMutation({
    mutationFn: (b: CreateCustomerRequest) => api.createCustomer(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commercial', 'customers'] }),
  });
}
export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: UpdateCustomerRequest) => api.updateCustomer(id, b),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: commercialKeys.customer(id) }),
        qc.invalidateQueries({ queryKey: ['commercial', 'customers'] }),
      ]),
  });
}

// ---- quotations ------------------------------------------

export const useQuotations = (p: ListQuotationsParams = {}) =>
  useQuery({ queryKey: commercialKeys.quotations(p), queryFn: () => api.listQuotations(p) });
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
export const useLeadQuotations = (leadId: string) =>
  useQuery({
    queryKey: commercialKeys.leadQuotations(leadId),
    queryFn: () => api.listLeadQuotations(leadId),
    enabled: !!leadId,
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
  return useMutation({
    mutationFn: (b: UpdateQuotationRequest) => api.updateQuotation(id, b),
    onSuccess: invalidate,
  });
}
export function useQuotationActions(id: string) {
  const invalidate = useInvalidateQuotation(id);
  return {
    revise: useMutation({
      mutationFn: (b: ReviseQuotationRequest = {}) => api.reviseQuotation(id, b),
      onSuccess: invalidate,
    }),
    send: useMutation({ mutationFn: () => api.sendQuotation(id), onSuccess: invalidate }),
    accept: useMutation({
      mutationFn: (b: AcceptQuotationRequest = {}) => api.acceptQuotation(id, b),
      onSuccess: invalidate,
    }),
    cancel: useMutation({ mutationFn: () => api.cancelQuotation(id), onSuccess: invalidate }),
    expire: useMutation({ mutationFn: () => api.expireQuotation(id), onSuccess: invalidate }),
    book: useMutation({ mutationFn: () => api.bookQuotation(id), onSuccess: invalidate }),
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
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteQuotationAttachment(id, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: commercialKeys.quotationAttachments(id) }),
  });
}
