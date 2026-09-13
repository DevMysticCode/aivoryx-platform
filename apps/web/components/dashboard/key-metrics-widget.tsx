'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccess } from '@/lib/navigation/use-access';
import { getCrmAnalyticsOverview } from '@/lib/api/crm-analytics';
import { supplyKeys } from '@/lib/supply/use-supply';
import * as supplyApi from '@/lib/api/supply';
import { financeKeys } from '@/lib/finance/use-finance';
import * as financeApi from '@/lib/api/finance';
import { hrKeys } from '@/lib/hr/use-hr';
import * as hrApi from '@/lib/api/hr';
import { Kpi } from './kpi';
import { WidgetCard, WidgetSkeleton } from './widget-card';

/**
 * Global Dashboard "Key business metrics" (Phase 13D §5) — up to four tiles,
 * each independently module + permission gated and backed by that module's
 * own existing read surface (queries are only enabled when the tile would
 * actually show, so a user without access never fetches that module's data).
 * A tile with no access is simply absent, not blank; the whole widget
 * disappears if nothing survives.
 */
export function KeyMetricsWidget() {
  const access = useAccess();

  const showLeads = access.hasModule('CRM') && access.can('crm.leads.read');
  const showProjects = access.hasModule('SUPPLY') && access.can('projects.read');
  const showOutstanding = access.hasModule('FINANCE') && access.can('finance.read');
  const showApprovals = access.hasModule('HR') && access.can('hr.organization.read');

  const leads = useQuery({
    queryKey: ['crm', 'analytics', 'overview', 30],
    queryFn: () => getCrmAnalyticsOverview(30),
    enabled: showLeads,
  });
  const projects = useQuery({
    queryKey: supplyKeys.projects({ pageSize: 1 }),
    queryFn: () => supplyApi.listProjects({ pageSize: 1 }),
    enabled: showProjects,
  });
  const finance = useQuery({
    queryKey: financeKeys.overview,
    queryFn: financeApi.financeOverview,
    enabled: showOutstanding,
  });
  const hr = useQuery({
    queryKey: hrKeys.dashboard,
    queryFn: hrApi.hrDashboard,
    enabled: showApprovals,
  });

  const tiles: { key: string; node: React.ReactNode }[] = [];

  if (showLeads) {
    tiles.push({
      key: 'leads',
      node: leads.isLoading ? (
        <WidgetSkeleton rows={1} />
      ) : (
        <Kpi
          label="Total leads"
          value={leads.data?.totals.total ?? 0}
          delta={leads.data?.trendDelta}
        />
      ),
    });
  }

  if (showProjects) {
    tiles.push({
      key: 'projects',
      node: projects.isLoading ? (
        <WidgetSkeleton rows={1} />
      ) : (
        <Kpi label="Projects" value={projects.data?.total ?? 0} />
      ),
    });
  }

  if (showOutstanding) {
    const rows = finance.data?.byCurrency ?? [];
    const primary = rows[0];
    tiles.push({
      key: 'outstanding',
      node: finance.isLoading ? (
        <WidgetSkeleton rows={1} />
      ) : primary ? (
        <Kpi
          label={`Outstanding (${primary.currency})`}
          value={new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: primary.currency,
            maximumFractionDigits: 0,
          }).format(Number(primary.outstandingTotal))}
          hint={
            rows.length > 1
              ? `+${rows.length - 1} more currenc${rows.length > 2 ? 'ies' : 'y'}`
              : undefined
          }
        />
      ) : (
        <Kpi label="Outstanding" value="—" hint="No invoices raised yet" />
      ),
    });
  }

  if (showApprovals) {
    const pending = (hr.data?.pendingLeaveApprovals ?? 0) + (hr.data?.pendingExpenseApprovals ?? 0);
    tiles.push({
      key: 'approvals',
      node: hr.isLoading ? (
        <WidgetSkeleton rows={1} />
      ) : (
        <Kpi label="Pending approvals" value={pending} hint="Leave · Expense" />
      ),
    });
  }

  if (tiles.length === 0) return null;

  return (
    <WidgetCard title="Key business metrics">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.key}>{t.node}</div>
        ))}
      </div>
    </WidgetCard>
  );
}
