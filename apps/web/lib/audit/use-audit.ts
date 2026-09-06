'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api/audit';

/**
 * TanStack Query hooks for the audit console (Phase 11, ADR 0040). Read-only;
 * server-side filtering + pagination — the client never loads the whole table.
 */

export function useAuditLog(filters: api.AuditFilters, page: number) {
  return useQuery({
    queryKey: ['audit', 'list', filters, page],
    queryFn: () => api.listAudit(filters, page),
    placeholderData: keepPreviousData,
  });
}

export function useAuditEntry(id: string | null) {
  return useQuery({
    queryKey: ['audit', 'entry', id],
    queryFn: () => api.getAuditEntry(id!),
    enabled: !!id,
  });
}
