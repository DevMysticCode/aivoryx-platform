import type { CreateSourceRequest, CreateSourceResponse, Source } from '@aivoryx/contracts';
import { apiFetch } from './client';

/** Admin surface for the Pabbly inbound connector (ADR 0032). */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const listSources = () =>
  apiFetch<Source[]>('/admin/integrations/sources', { cache: 'no-store' });

export const createSource = (body: CreateSourceRequest) =>
  apiFetch<CreateSourceResponse>('/admin/integrations/sources', json(body));

export const rotateSourceSecret = (sourceId: string) =>
  apiFetch<CreateSourceResponse>(`/admin/integrations/sources/${sourceId}/rotate-secret`, json({}));

export const revokeSource = (sourceId: string) =>
  apiFetch<Source>(`/admin/integrations/sources/${sourceId}/revoke`, json({}));

export const reactivateSource = (sourceId: string) =>
  apiFetch<Source>(`/admin/integrations/sources/${sourceId}/reactivate`, json({}));

export interface InboundEventSummary {
  id: string;
  rawEventId: string;
  sourceId: string;
  status: string;
  leadId: string | null;
  dedupeOutcome: string | null;
  processingAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

export const listInboundEvents = () =>
  apiFetch<InboundEventSummary[]>('/admin/integrations/events', { cache: 'no-store' });

export const getInboundEvent = (id: string) =>
  apiFetch<{ event: InboundEventSummary; raw: unknown; log: unknown[] }>(
    `/admin/integrations/events/${id}`,
    { cache: 'no-store' },
  );

export const replayInboundEvent = (id: string) =>
  apiFetch<{ status: string; leadId?: string }>(
    `/admin/integrations/events/${id}/replay`,
    json({}),
  );
