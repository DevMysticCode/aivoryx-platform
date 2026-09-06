import type {
  AllocatePaymentRequest,
  CancelCreditNoteRequest,
  CancelInvoiceRequest,
  CreateCreditNoteRequest,
  CreateInvoiceFromQuotationRequest,
  CreateInvoiceRequest,
  CreditNote,
  CreditNoteList,
  CustomerFinancialView,
  FinanceOverview,
  FinancialSummary,
  InvoiceDetail,
  InvoiceList,
  IssueInvoiceRequest,
  PaymentDetail,
  PaymentList,
  RecordPaymentRequest,
  ReversePaymentRequest,
  UpdateInvoiceRequest,
} from '@aivoryx/contracts';
import { API_V1_PREFIX } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch } from './client';

/** Finance API calls (Phase 9, ADR 0038). Ownership is server-side. */

const json = (body: unknown, method = 'POST', idempotencyKey?: string): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ---- invoices --------------------------------------------------

export const listInvoices = (opts: {
  status?: string;
  customerId?: string;
  projectId?: string;
  overdue?: boolean;
  q?: string;
  page?: number;
}) => apiFetch<InvoiceList>(`/finance/invoices${qs(opts)}`, { cache: 'no-store' });

export const getInvoice = (id: string) =>
  apiFetch<InvoiceDetail>(`/finance/invoices/${id}`, { cache: 'no-store' });

export const createInvoice = (body: CreateInvoiceRequest, idempotencyKey?: string) =>
  apiFetch<InvoiceDetail>('/finance/invoices', json(body, 'POST', idempotencyKey));

export const createInvoiceFromQuotation = (body: CreateInvoiceFromQuotationRequest) =>
  apiFetch<InvoiceDetail>('/finance/invoices/from-quotation', json(body));

export const updateInvoice = (id: string, body: UpdateInvoiceRequest) =>
  apiFetch<InvoiceDetail>(`/finance/invoices/${id}`, json(body, 'PATCH'));

export const issueInvoice = (id: string, body: IssueInvoiceRequest = {}) =>
  apiFetch<InvoiceDetail>(`/finance/invoices/${id}/issue`, json(body));

export const cancelInvoice = (id: string, body: CancelInvoiceRequest = {}) =>
  apiFetch<InvoiceDetail>(`/finance/invoices/${id}/cancel`, json(body));

export const invoicePrintUrl = (id: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/finance/invoices/${id}/print`;

// ---- payments -------------------------------------------------

export const listPayments = (opts: {
  status?: string;
  customerId?: string;
  unallocatedOnly?: boolean;
  page?: number;
}) => apiFetch<PaymentList>(`/finance/payments${qs(opts)}`, { cache: 'no-store' });

export const getPayment = (id: string) =>
  apiFetch<PaymentDetail>(`/finance/payments/${id}`, { cache: 'no-store' });

export const recordPayment = (body: RecordPaymentRequest, idempotencyKey?: string) =>
  apiFetch<PaymentDetail>('/finance/payments', json(body, 'POST', idempotencyKey));

export const allocatePayment = (id: string, body: AllocatePaymentRequest) =>
  apiFetch<PaymentDetail>(`/finance/payments/${id}/allocate`, json(body));

export const reversePayment = (id: string, body: ReversePaymentRequest = {}) =>
  apiFetch<PaymentDetail>(`/finance/payments/${id}/reverse`, json(body));

export const paymentPrintUrl = (id: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/finance/payments/${id}/print`;

// ---- credit notes ------------------------------------------

export const listCreditNotes = (opts: { status?: string; customerId?: string; page?: number }) =>
  apiFetch<CreditNoteList>(`/finance/credit-notes${qs(opts)}`, { cache: 'no-store' });

export const getCreditNote = (id: string) =>
  apiFetch<CreditNote>(`/finance/credit-notes/${id}`, { cache: 'no-store' });

export const createCreditNote = (body: CreateCreditNoteRequest) =>
  apiFetch<CreditNote>('/finance/credit-notes', json(body));

export const issueCreditNote = (id: string) =>
  apiFetch<CreditNote>(`/finance/credit-notes/${id}/issue`, json({}));

export const cancelCreditNote = (id: string, body: CancelCreditNoteRequest = {}) =>
  apiFetch<CreditNote>(`/finance/credit-notes/${id}/cancel`, json(body));

// ---- summaries ------------------------------------------

export const financeOverview = () =>
  apiFetch<FinanceOverview>('/finance/overview', { cache: 'no-store' });

export const customerFinancialSummary = (customerId: string) =>
  apiFetch<CustomerFinancialView>(`/finance/customers/${customerId}/summary`, {
    cache: 'no-store',
  });

export const projectFinancialSummary = (projectId: string) =>
  apiFetch<FinancialSummary>(`/finance/projects/${projectId}/summary`, { cache: 'no-store' });
