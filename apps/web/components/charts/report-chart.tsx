'use client';

import { useState } from 'react';
import { ErrorBlock } from '@/components/ui/kit';
import { WidgetSkeleton } from '@/components/dashboard/widget-card';
import { getReport, reportHref } from '@/lib/reports/registry';
import { InteractiveChart } from './interactive-chart';

/** Renders a registered report as an interactive chart with loading / error / empty states. */
export function ReportChart({ id, standalone }: { id: string; standalone?: boolean }) {
  const def = getReport(id);
  const [range, setRange] = useState(def?.defaultRange ?? 30);
  // hooks must run unconditionally; an unknown id renders nothing after them
  const result = (def ?? getReport('crm-pipeline')!).useData(range);
  if (!def) return null;

  if (result.isLoading) return <WidgetSkeleton rows={4} />;
  if (result.error)
    return (
      <ErrorBlock
        error={result.error}
        onRetry={result.refetch}
        title={`${def.title} could not be loaded`}
      />
    );
  if (!result.data) return null;

  return (
    <InteractiveChart
      id={def.id}
      title={def.title}
      data={result.data}
      ranges={def.ranges}
      range={range}
      onRangeChange={setRange}
      reportHref={reportHref(def.id)}
      standalone={standalone}
    />
  );
}
