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
import { ClipboardCheck, FolderKanban, Users, Wallet } from 'lucide-react';
import { DashboardKpiCard, DashboardKpiGrid } from '@/components/dashboard-kit';

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

  const tiles: React.ReactNode[] = [];

  if (showLeads) {
    const d = leads.data?.trendDelta;
    tiles.push(
      <DashboardKpiCard
        key="leads"
        label="Total leads"
        icon={Users}
        tone="teal"
        isLoading={leads.isLoading}
        value={leads.data?.totals.total ?? 0}
        description={leads.data ? `${leads.data.totals.open} open` : undefined}
        delta={
          d && d.changePct !== null ? { changePct: d.changePct, label: 'vs prior week' } : null
        }
        href="/crm"
      />,
    );
  }

  if (showProjects) {
    tiles.push(
      <DashboardKpiCard
        key="projects"
        label="Projects"
        icon={FolderKanban}
        tone="purple"
        isLoading={projects.isLoading}
        value={projects.data?.total ?? 0}
        href="/projects"
      />,
    );
  }

  if (showOutstanding) {
    const rows = finance.data?.byCurrency ?? [];
    const primary = rows[0];
    tiles.push(
      <DashboardKpiCard
        key="outstanding"
        label={primary ? `Outstanding (${primary.currency})` : 'Outstanding'}
        icon={Wallet}
        tone="orange"
        isLoading={finance.isLoading}
        value={
          primary
            ? new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: primary.currency,
                maximumFractionDigits: 0,
              }).format(Number(primary.outstandingTotal))
            : null
        }
        emptyText="No invoices raised yet"
        description={
          rows.length > 1
            ? `+${rows.length - 1} more currenc${rows.length > 2 ? 'ies' : 'y'}`
            : undefined
        }
        href="/finance"
      />,
    );
  }

  if (showApprovals) {
    const pending = (hr.data?.pendingLeaveApprovals ?? 0) + (hr.data?.pendingExpenseApprovals ?? 0);
    tiles.push(
      <DashboardKpiCard
        key="approvals"
        label="Pending approvals"
        icon={ClipboardCheck}
        tone="amber"
        isLoading={hr.isLoading}
        value={pending}
        description="Leave · Expense"
        href="/hr"
      />,
    );
  }

  if (tiles.length === 0) return null;

  return <DashboardKpiGrid>{tiles}</DashboardKpiGrid>;
}
