'use client';

import { useQuery } from '@tanstack/react-query';
import { getCrmAnalyticsOverview } from '@/lib/api/crm-analytics';

/**
 * CRM analytics overview (Phase 13D). One call to the dedicated read-only
 * aggregation endpoint — pipeline, trend, sources, funnel, follow-ups, recent
 * activity, and (when the caller's data scope allows) team performance. The
 * backend is authoritative on every number here; the hook does not compute or
 * invent anything.
 */
export function useCrmAnalytics(days: 7 | 30 | 90 = 30) {
  const query = useQuery({
    queryKey: ['crm', 'analytics', 'overview', days],
    queryFn: () => getCrmAnalyticsOverview(days),
    staleTime: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
