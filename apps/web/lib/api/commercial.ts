import type {
  AcceptQuotationRequest,
  BookingResult,
  BookQuotationRequest,
  CreateCustomerRequest,
  CreateQuotationRequest,
  Customer,
  CustomerDetail,
  CustomerList,
  PromoteLeadRequest,
  Quotation,
  QuotationActivity,
  QuotationAttachment,
  QuotationDetail,
  QuotationList,
  ReviseQuotationRequest,
  UpdateCustomerRequest,
  UpdateQuotationRequest,
} from '@aivoryx/contracts';
import { API_V1_PREFIX, type ApiErrorResponse } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch, ApiError } from './client';

/** Commercial — customers, quotations & project booking (ADR 0035). Server-authorized. */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const qs = (params: object): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>))
    if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ---- customers ------------------------------------------------

export interface ListCustomersParams {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}
export const listCustomers = (p: ListCustomersParams = {}) =>
  apiFetch<CustomerList>(`/customers${qs(p)}`, { cache: 'no-store' });
export const getCustomer = (id: string) =>
  apiFetch<CustomerDetail>(`/customers/${id}`, { cache: 'no-store' });
export const createCustomer = (b: CreateCustomerRequest) =>
  apiFetch<CustomerDetail>('/customers', json(b));
export const updateCustomer = (id: string, b: UpdateCustomerRequest) =>
  apiFetch<CustomerDetail>(`/customers/${id}`, json(b, 'PATCH'));
export const promoteLead = (leadId: string, b: PromoteLeadRequest = {}) =>
  apiFetch<CustomerDetail>(`/customers/from-lead/${leadId}`, json(b));

// ---- quotations ---------------------------------------------

export interface ListQuotationsParams {
  status?: string;
  customerId?: string;
  leadId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}
export const listQuotations = (p: ListQuotationsParams = {}) =>
  apiFetch<QuotationList>(`/quotations${qs(p)}`, { cache: 'no-store' });
export const getQuotation = (id: string) =>
  apiFetch<QuotationDetail>(`/quotations/${id}`, { cache: 'no-store' });
export const listQuotationActivities = (id: string) =>
  apiFetch<QuotationActivity[]>(`/quotations/${id}/activities`, { cache: 'no-store' });
export const listLeadQuotations = (leadId: string) =>
  apiFetch<QuotationList>(`/leads/${leadId}/quotations`, { cache: 'no-store' });
export const createQuotation = (b: CreateQuotationRequest) =>
  apiFetch<QuotationDetail>('/quotations', json(b));
export const updateQuotation = (id: string, b: UpdateQuotationRequest) =>
  apiFetch<QuotationDetail>(`/quotations/${id}`, json(b, 'PATCH'));
export const reviseQuotation = (id: string, b: ReviseQuotationRequest = {}) =>
  apiFetch<QuotationDetail>(`/quotations/${id}/revise`, json(b));
export const sendQuotation = (id: string) =>
  apiFetch<QuotationDetail>(`/quotations/${id}/send`, json({}));
export const acceptQuotation = (id: string, b: AcceptQuotationRequest = {}) =>
  apiFetch<QuotationDetail>(`/quotations/${id}/accept`, json(b));
export const cancelQuotation = (id: string) =>
  apiFetch<QuotationDetail>(`/quotations/${id}/cancel`, json({}));
export const expireQuotation = (id: string) =>
  apiFetch<QuotationDetail>(`/quotations/${id}/expire`, json({}));
export const bookQuotation = (id: string, b: BookQuotationRequest = {}) =>
  apiFetch<BookingResult>(`/quotations/${id}/book`, json(b));

/** URL of the server-rendered printable quotation (opened in a new tab; the
 *  session cookie is sent same-site). */
export const quotationPrintUrl = (id: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/quotations/${id}/print`;

// ---- quotation attachments (existing object storage) ------

export const listQuotationAttachments = (id: string) =>
  apiFetch<QuotationAttachment[]>(`/quotations/${id}/attachments`, { cache: 'no-store' });

export async function uploadQuotationAttachment(
  id: string,
  file: File,
): Promise<QuotationAttachment> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<QuotationAttachment>(`/quotations/${id}/attachments`, {
    method: 'POST',
    body: form,
  });
}

export const deleteQuotationAttachment = (id: string, attachmentId: string) =>
  apiFetch<void>(`/quotations/${id}/attachments/${attachmentId}`, { method: 'DELETE' });

export async function fetchQuotationAttachmentBlob(
  id: string,
  attachmentId: string,
): Promise<{ blob: Blob; objectUrl: string }> {
  const url = `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/quotations/${id}/attachments/${attachmentId}/download`;
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

export type { Customer, Quotation };
