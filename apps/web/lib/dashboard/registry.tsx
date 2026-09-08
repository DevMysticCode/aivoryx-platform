import type { DashboardWidget } from './types';
import { QuickActionsWidget } from '@/components/dashboard/common-widgets';
import { CrmPipelineWidget, CrmFollowupsWidget } from '@/components/dashboard/crm-widgets';
import { HrDashboardWidget } from '@/components/dashboard/hr-widgets';
import { FinanceOverviewWidget } from '@/components/dashboard/finance-widgets';
import { FieldVisitsWidget } from '@/components/dashboard/field-widgets';

/**
 * The dashboard widget registry (Phase 13C §2–3). Each business module
 * contributes entries here; the dashboard page composes whatever survives the
 * entitlement + permission filter. This is the single cross-module composition
 * point — the dashboard framework (`lib/dashboard/{types,use-dashboard}`) and
 * the page import no business code.
 */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  {
    key: 'quick-actions',
    title: 'Quick actions',
    span: 12,
    priority: 0,
    Component: QuickActionsWidget,
  },
  {
    key: 'crm-pipeline',
    module: 'CRM',
    permissions: ['crm.leads.read'],
    title: 'Lead pipeline',
    span: 6,
    priority: 10,
    Component: CrmPipelineWidget,
  },
  {
    key: 'crm-recent',
    module: 'CRM',
    permissions: ['crm.leads.read'],
    title: 'Recent leads',
    span: 6,
    priority: 20,
    Component: CrmFollowupsWidget,
  },
  {
    key: 'field-visits',
    module: 'FIELD',
    permissions: ['field.visits.read'],
    title: 'Field visits',
    span: 6,
    priority: 30,
    Component: FieldVisitsWidget,
  },
  {
    key: 'finance-receivables',
    module: 'FINANCE',
    permissions: ['finance.read'],
    title: 'Receivables',
    span: 6,
    priority: 40,
    Component: FinanceOverviewWidget,
  },
  {
    key: 'hr-workforce',
    module: 'HR',
    permissions: ['hr.organization.read'],
    title: 'Workforce',
    span: 6,
    priority: 50,
    Component: HrDashboardWidget,
  },
];
