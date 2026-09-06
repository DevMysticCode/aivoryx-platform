import type { AuditLogDetail, AuditLogList } from '@aivoryx/contracts';
import { apiFetch } from './client';

/**
 * Global Audit Log — read-only API client (Phase 11, ADR 0040). The audit trail
 * is append-only; there is no create/update/delete here by design.
 */

export interface AuditFilters {
  from?: string;
  to?: string;
  actorMembershipId?: string;
  actorType?: 'USER' | 'SYSTEM';
  action?: string;
  module?: string;
  entityType?: string;
  entityId?: string;
}

export function listAudit(
  filters: AuditFilters,
  page: number,
  pageSize = 25,
): Promise<AuditLogList> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  qs.set('page', String(page));
  qs.set('pageSize', String(pageSize));
  return apiFetch<AuditLogList>(`/admin/audit?${qs.toString()}`, { cache: 'no-store' });
}

export const getAuditEntry = (id: string) =>
  apiFetch<AuditLogDetail>(`/admin/audit/${id}`, { cache: 'no-store' });
