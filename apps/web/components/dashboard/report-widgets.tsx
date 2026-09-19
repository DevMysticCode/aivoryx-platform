'use client';

import { ReportChart } from '@/components/charts/report-chart';
import { WidgetCard } from './widget-card';

export function LeadTrendWidget() {
  return (
    <WidgetCard title="Lead activity" href="/crm" linkLabel="CRM overview">
      <ReportChart id="crm-lead-trend" />
    </WidgetCard>
  );
}
