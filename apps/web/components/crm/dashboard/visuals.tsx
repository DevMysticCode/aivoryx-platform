'use client';

import Link from 'next/link';
import type { CrmFunnelStage, CrmSourcePerformance } from '@aivoryx/contracts';
import { Gauge } from '@/components/charts/gauge';
import { DashboardEmptyState } from '@/components/dashboard-kit';

export const STAGE_LABEL: Record<string, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
};

/**
 * Conversion funnel: bars whose widths are the REAL stage counts (relative to the
 * largest stage), each labelled with its count and the backend's own conversion
 * percentages. The overall New → Converted rate is shown as a gauge using the
 * backend's `conversionFromStart`; nothing is derived or estimated here.
 */
export function ConversionFunnel({ funnel }: { funnel: CrmFunnelStage[] }) {
  const max = Math.max(1, ...funnel.map((s) => s.count));
  const converted = funnel.find((s) => s.stage === 'CONVERTED');
  const overall = converted?.conversionFromStart ?? null;
  const first = funnel[0]?.count ?? 0;

  if (first === 0 && funnel.every((s) => s.count === 0)) {
    return (
      <DashboardEmptyState
        title="No leads in the funnel yet"
        description="Stages fill in as leads are created and worked."
      />
    );
  }
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      {overall !== null ? (
        <Gauge
          compact
          data={{
            shape: 'target',
            label: 'New → converted',
            value: overall,
            min: 0,
            max: 100,
            unit: '%',
            secondary: `${converted?.count ?? 0} of ${first} new leads`,
          }}
        />
      ) : null}
      <ul className="space-y-2.5">
        {funnel.map((s, i) => {
          const width = Math.max(2, (s.count / max) * 100);
          return (
            <li key={s.stage}>
              <Link
                href={`/crm/leads?status=${s.stage}`}
                className="group block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{s.count}</span>
                    {i > 0 && s.conversionFromPrevious !== null ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.conversionFromPrevious}% of previous
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] group-hover:bg-primary-hover"
                    style={{ width: `${width}%`, opacity: 1 - i * 0.12 }}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Lead sources: bars for lead volume plus the real qualified / converted / rate figures. */
export function SourceBars({ sources }: { sources: CrmSourcePerformance[] }) {
  if (sources.length === 0) {
    return (
      <DashboardEmptyState
        title="No leads in this range"
        description="Sources appear here once leads arrive."
      />
    );
  }
  const max = Math.max(1, ...sources.map((s) => s.total));
  return (
    <ul className="space-y-3">
      {sources.map((s) => (
        <li key={s.sourceId ?? 'manual'}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{s.sourceName}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold">{s.total}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {s.qualified} qualified · {s.converted} converted
                {s.conversionRate !== null ? ` · ${s.conversionRate}%` : ''}
              </span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-chart-1"
              style={{ width: `${Math.max(2, (s.total / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
