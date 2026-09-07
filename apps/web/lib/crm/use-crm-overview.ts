'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { listLeads } from '@/lib/api/crm';

export const LEAD_STATUSES = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'QUALIFIED',
  'DISQUALIFIED',
  'CONVERTED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * CRM Overview data (§27). Built entirely from the existing paginated
 * `GET /crm/leads` endpoint — one cheap `pageSize:1` call per status for the
 * counts, plus a small recent-leads page. No new backend surface.
 */
export function useCrmOverview() {
  const recent = useQuery({
    queryKey: ['crm', 'overview', 'recent'],
    queryFn: () => listLeads({ page: 1, pageSize: 8 }),
  });

  const counts = useQueries({
    queries: LEAD_STATUSES.map((status) => ({
      queryKey: ['crm', 'overview', 'count', status],
      queryFn: () => listLeads({ status, page: 1, pageSize: 1 }),
      staleTime: 30_000,
    })),
  });

  const byStatus = Object.fromEntries(
    LEAD_STATUSES.map((s, i) => [s, counts[i]?.data?.total ?? 0]),
  ) as Record<LeadStatus, number>;

  const total = recent.data?.total ?? Object.values(byStatus).reduce((a, b) => a + b, 0);
  const open = byStatus.NEW + byStatus.ASSIGNED + byStatus.CONTACTED;
  const conversionRate = total > 0 ? Math.round((byStatus.CONVERTED / total) * 100) : 0;

  return {
    isLoading: recent.isLoading || counts.some((c) => c.isLoading),
    error: recent.error ?? counts.find((c) => c.error)?.error ?? null,
    refetch: () => {
      void recent.refetch();
      counts.forEach((c) => void c.refetch());
    },
    total,
    open,
    byStatus,
    conversionRate,
    recent: recent.data?.items ?? [],
  };
}
