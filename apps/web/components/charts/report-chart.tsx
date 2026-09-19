'use client';

import { useState } from 'react';
import { ErrorBlock } from '@/components/ui/kit';
import { WidgetSkeleton } from '@/components/dashboard/widget-card';
import { getReport, reportHref } from '@/lib/reports/registry';
import { InteractiveChart } from './interactive-chart';

/** Renders a registered report as an interactive chart with loading / error / empty states. */
export function ReportChart({
  id,
  standalone,
  range: controlledRange,
  onRangeChange,
  hideRanges,
}: {
  id: string;
  standalone?: boolean;
  /** a parent (e.g. a dashboard header) owns the date range */
  range?: number;
  onRangeChange?: (v: number) => void;
  hideRanges?: boolean;
}) {
  const def = getReport(id);
  const [localRange, setLocalRange] = useState(def?.defaultRange ?? 30);
  const range = controlledRange ?? localRange;
  const setRange = onRangeChange ?? setLocalRange;
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
  if (!result.data) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Not enough data yet.</p>;
  }

  return (
    <InteractiveChart
      id={def.id}
      title={def.title}
      data={result.data}
      ranges={hideRanges ? undefined : def.ranges}
      range={range}
      onRangeChange={setRange}
      reportHref={reportHref(def.id)}
      standalone={standalone}
    />
  );
}
