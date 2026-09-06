'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AllocatePaymentRequest,
  CreateCreditNoteRequest,
  CreateInvoiceRequest,
  RecordPaymentRequest,
  UpdateInvoiceRequest,
} from '@aivoryx/contracts';
import * as api from '@/lib/api/finance';

/** TanStack Query hooks for the finance surface (Phase 9, ADR 0038). */

export const financeKeys = {
  overview: ['finance', 'overview'] as const,
  invoices: (f: Record<string, unknown>) => ['finance', 'invoices', f] as const,
  invoice: (id: string) => ['finance', 'invoice', id] as const,
  payments: (f: Record<string, unknown>) => ['finance', 'payments', f] as const,
  payment: (id: string) => ['finance', 'payment', id] as const,
  creditNotes: (f: Record<string, unknown>) => ['finance', 'credit-notes', f] as const,
  creditNote: (id: string) => ['finance', 'credit-note', id] as const,
  customerSummary: (id: string) => ['finance', 'customer-summary', id] as const,
  projectSummary: (id: string) => ['finance', 'project-summary', id] as const,
};

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['finance'] });

export const useFinanceOverview = () =>
  useQuery({ queryKey: financeKeys.overview, queryFn: api.financeOverview });

export const useInvoices = (filters: Parameters<typeof api.listInvoices>[0]) =>
  useQuery({ queryKey: financeKeys.invoices(filters), queryFn: () => api.listInvoices(filters) });

export const useInvoice = (id: string) =>
  useQuery({ queryKey: financeKeys.invoice(id), queryFn: () => api.getInvoice(id), enabled: !!id });

export const usePayments = (filters: Parameters<typeof api.listPayments>[0]) =>
  useQuery({ queryKey: financeKeys.payments(filters), queryFn: () => api.listPayments(filters) });

export const usePayment = (id: string) =>
  useQuery({ queryKey: financeKeys.payment(id), queryFn: () => api.getPayment(id), enabled: !!id });

export const useCreditNotes = (filters: Parameters<typeof api.listCreditNotes>[0]) =>
  useQuery({
    queryKey: financeKeys.creditNotes(filters),
    queryFn: () => api.listCreditNotes(filters),
  });

export const useCreditNote = (id: string) =>
  useQuery({
    queryKey: financeKeys.creditNote(id),
    queryFn: () => api.getCreditNote(id),
    enabled: !!id,
  });

export const useCustomerFinancialSummary = (id: string) =>
  useQuery({
    queryKey: financeKeys.customerSummary(id),
    queryFn: () => api.customerFinancialSummary(id),
    enabled: !!id,
    retry: false,
  });

export const useProjectFinancialSummary = (id: string) =>
  useQuery({
    queryKey: financeKeys.projectSummary(id),
    queryFn: () => api.projectFinancialSummary(id),
    enabled: !!id,
    retry: false,
  });

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInvoiceRequest) => api.createInvoice(body),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateInvoiceRequest) => api.updateInvoice(id, body),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useInvoiceAction(id: string) {
  const qc = useQueryClient();
  const done = () => invalidateAll(qc);
  return {
    issue: useMutation({ mutationFn: () => api.issueInvoice(id), onSuccess: done }),
    cancel: useMutation({
      mutationFn: (mode: 'CANCELLED' | 'VOID') => api.cancelInvoice(id, { mode }),
      onSuccess: done,
    }),
  };
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordPaymentRequest) => api.recordPayment(body),
    onSuccess: () => invalidateAll(qc),
  });
}

export function usePaymentAction(id: string) {
  const qc = useQueryClient();
  const done = () => invalidateAll(qc);
  return {
    allocate: useMutation({
      mutationFn: (body: AllocatePaymentRequest) => api.allocatePayment(id, body),
      onSuccess: done,
    }),
    reverse: useMutation({
      mutationFn: (reason: string) => api.reversePayment(id, { reason: reason || undefined }),
      onSuccess: done,
    }),
  };
}

export function useCreateCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCreditNoteRequest) => api.createCreditNote(body),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useCreditNoteAction(id: string) {
  const qc = useQueryClient();
  const done = () => invalidateAll(qc);
  return {
    issue: useMutation({ mutationFn: () => api.issueCreditNote(id), onSuccess: done }),
    cancel: useMutation({ mutationFn: () => api.cancelCreditNote(id), onSuccess: done }),
  };
}
