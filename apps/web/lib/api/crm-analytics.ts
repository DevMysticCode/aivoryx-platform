import type { CrmAnalyticsOverview } from '@aivoryx/contracts';
import { apiFetch } from './client';

/** CRM analytics API calls (Phase 13D). Read-only, tenant/permission-scoped server-side. */

export const getCrmAnalyticsOverview = (days = 30) =>
  apiFetch<CrmAnalyticsOverview>(`/crm/analytics/overview?days=${days}`, { cache: 'no-store' });
