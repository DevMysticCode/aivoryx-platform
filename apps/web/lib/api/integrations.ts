import type {
  CreateSourceRequest,
  CreateSourceResponse,
  EventDetailResponse,
  EventListResponse,
  ProviderMeta,
  SetSourceCredentialsRequest,
  Source,
  UpdateSourceRequest,
} from '@aivoryx/contracts';
import { apiFetch } from './client';

/** Admin surface for the Universal Connector Integration Center (ADR 0032, UC-3, UC-4). */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const listSources = () =>
  apiFetch<Source[]>('/admin/integrations/sources', { cache: 'no-store' });

export const getSource = (sourceId: string) =>
  apiFetch<Source>(`/admin/integrations/sources/${sourceId}`, { cache: 'no-store' });

export const createSource = (body: CreateSourceRequest) =>
  apiFetch<CreateSourceResponse>('/admin/integrations/sources', json(body));

/** Only `name`/`fieldMapping` — the key and connector type are immutable (UC-4). */
export const updateSource = (sourceId: string, body: UpdateSourceRequest) =>
  apiFetch<Source>(`/admin/integrations/sources/${sourceId}`, json(body, 'PATCH'));

export const rotateSourceSecret = (sourceId: string) =>
  apiFetch<CreateSourceResponse>(`/admin/integrations/sources/${sourceId}/rotate-secret`, json({}));

export const revokeSource = (sourceId: string) =>
  apiFetch<Source>(`/admin/integrations/sources/${sourceId}/revoke`, json({}));

export const reactivateSource = (sourceId: string) =>
  apiFetch<Source>(`/admin/integrations/sources/${sourceId}/reactivate`, json({}));

/** Write-only (UC-3): configures a signature-style source's (Meta) recoverable credential. The
 *  values are never returned — only `Source.hasCredentials` reflects that something is configured. */
export const setSourceCredentials = (sourceId: string, data: SetSourceCredentialsRequest['data']) =>
  apiFetch<Source>(`/admin/integrations/sources/${sourceId}/credentials`, json({ data }, 'PUT'));

/** Safe, server-driven provider catalog (UC-4) — never a credential value, only field names the
 *  Integration Center should render in a credential form. */
export const listProviders = () =>
  apiFetch<ProviderMeta[]>('/admin/integrations/providers', { cache: 'no-store' });

export interface ListInboundEventsParams {
  sourceId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/** Server-side pagination only (UC-4) — never page through an unbounded result client-side. */
export const listInboundEvents = (params: ListInboundEventsParams = {}) => {
  const query = new URLSearchParams();
  if (params.sourceId) query.set('sourceId', params.sourceId);
  if (params.status) query.set('status', params.status);
  query.set('page', String(params.page ?? 1));
  query.set('pageSize', String(params.pageSize ?? 25));
  return apiFetch<EventListResponse>(`/admin/integrations/events?${query.toString()}`, {
    cache: 'no-store',
  });
};

export const getInboundEvent = (id: string) =>
  apiFetch<EventDetailResponse>(`/admin/integrations/events/${id}`, { cache: 'no-store' });

export const replayInboundEvent = (id: string) =>
  apiFetch<{ status: string; leadId?: string }>(
    `/admin/integrations/events/${id}/replay`,
    json({}),
  );
