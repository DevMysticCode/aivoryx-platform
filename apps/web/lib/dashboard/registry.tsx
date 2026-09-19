import type { DashboardWidget } from './types';
import { QuickActionsWidget } from '@/components/dashboard/common-widgets';
import { KeyMetricsWidget } from '@/components/dashboard/key-metrics-widget';
import {
  AttentionRequiredWidget,
  UpcomingWorkWidget,
} from '@/components/dashboard/attention-widgets';
import { CrmPipelineWidget, CrmFollowupsWidget } from '@/components/dashboard/crm-widgets';
import { HrDashboardWidget } from '@/components/dashboard/hr-widgets';
import { FinanceOverviewWidget } from '@/components/dashboard/finance-widgets';
import { FieldVisitsWidget } from '@/components/dashboard/field-widgets';
import { HrSelfWidget } from '@/components/dashboard/hr-self-widget';
import { LeadTrendWidget } from '@/components/dashboard/report-widgets';

/**
 * The dashboard widget registry (Phase 13C §2–3, extended Phase 13D §5). Each
 * business module contributes entries here; the dashboard page composes
 * whatever survives the entitlement + permission filter, grouped into visual
 * sections by `section` (via `groupWidgetsBySection`). This is the single
 * cross-module composition point — the dashboard framework
 * (`lib/dashboard/{types,use-dashboard,select}`) and the page import no
 * business code. The cross-module widgets below (`key-metrics-widget.tsx`,
 * `attention-widgets.tsx`) are themselves module-less at the registry level —
 * they re-check module/permission access per tile internally, exactly like
 * `QuickActionsWidget` already did, so no single module's absence hides the
 * whole widget for everyone else.
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
    key: 'key-metrics',
    title: 'Key business metrics',
    span: 12,
    priority: 5,
    section: 'Key metrics',
    Component: KeyMetricsWidget,
  },
  {
    key: 'attention-required',
    title: 'Attention required',
    span: 6,
    priority: 6,
    section: 'Primary work',
    Component: AttentionRequiredWidget,
  },
  {
    key: 'upcoming-work',
    title: 'Upcoming work',
    span: 6,
    priority: 7,
    section: 'Primary work',
    Component: UpcomingWorkWidget,
  },
  {
    key: 'hr-self',
    module: 'HR',
    permissions: ['hr.attendance.self'],
    title: 'My day',
    span: 6,
    priority: 8,
    section: 'Primary work',
    Component: HrSelfWidget,
  },
  {
    key: 'crm-pipeline',
    module: 'CRM',
    permissions: ['crm.leads.read'],
    title: 'Lead pipeline',
    span: 6,
    priority: 10,
    section: 'Analysis',
    Component: CrmPipelineWidget,
  },
  {
    key: 'crm-recent',
    module: 'CRM',
    permissions: ['crm.leads.read'],
    title: 'Recent leads',
    span: 6,
    priority: 20,
    section: 'Analysis',
    Component: CrmFollowupsWidget,
  },
  {
    key: 'crm-lead-trend',
    module: 'CRM',
    permissions: ['crm.leads.read'],
    title: 'Lead activity',
    span: 6,
    priority: 25,
    section: 'Analysis',
    Component: LeadTrendWidget,
  },
  {
    key: 'field-visits',
    module: 'FIELD',
    permissions: ['field.visits.read'],
    title: 'Field visits',
    span: 6,
    priority: 30,
    section: 'Analysis',
    Component: FieldVisitsWidget,
  },
  {
    key: 'finance-receivables',
    module: 'FINANCE',
    permissions: ['finance.read'],
    title: 'Receivables',
    span: 6,
    priority: 40,
    section: 'Analysis',
    Component: FinanceOverviewWidget,
  },
  {
    key: 'hr-workforce',
    module: 'HR',
    permissions: ['hr.organization.read'],
    title: 'Workforce',
    span: 6,
    priority: 50,
    section: 'Analysis',
    Component: HrDashboardWidget,
  },
];
