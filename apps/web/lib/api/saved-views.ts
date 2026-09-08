import type { CreateSavedViewRequest, SavedView, UpdateSavedViewRequest } from '@aivoryx/contracts';
import { apiFetch } from './client';

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Persistent CRM lead-list saved views (Phase 13C). Owned per membership, server-authoritative. */
export const listSavedViews = () =>
  apiFetch<SavedView[]>('/crm/saved-views', { cache: 'no-store' });

export const createSavedView = (body: CreateSavedViewRequest) =>
  apiFetch<SavedView>('/crm/saved-views', json(body));

export const updateSavedView = (id: string, body: UpdateSavedViewRequest) =>
  apiFetch<SavedView>(`/crm/saved-views/${id}`, json(body, 'PATCH'));

export const deleteSavedView = (id: string) =>
  apiFetch<void>(`/crm/saved-views/${id}`, { method: 'DELETE' });
