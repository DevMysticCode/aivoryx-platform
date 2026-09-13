'use client';

import Link from 'next/link';
import type { CrmFunnelStage } from '@aivoryx/contracts';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
};

/**
 * The pipeline visualization (Phase 13D §6) — large, clickable funnel stages
 * that navigate to the existing lead list filtered by status. Widths are
 * proportional to the largest stage count; no invented percentages here (the
 * conversion numbers live in the separate Funnel component).
 */
export function PipelineVisualization({ funnel }: { funnel: CrmFunnelStage[] }) {
  const max = Math.max(1, ...funnel.map((s) => s.count));
  return (
    <ul className="space-y-3">
      {funnel.map((s) => (
        <li key={s.stage}>
          <Link
            href={`/crm/leads?status=${s.stage}`}
            className="group flex items-center gap-4 rounded-md px-1 py-1 hover:bg-accent/40"
          >
            <span className="w-24 shrink-0 text-sm font-medium text-muted-foreground group-hover:text-foreground">
              {STAGE_LABEL[s.stage] ?? s.stage}
            </span>
            <span className="relative h-7 flex-1 overflow-hidden rounded bg-secondary">
              <span
                className="absolute inset-y-0 left-0 rounded bg-primary transition-[width]"
                style={{ width: `${(s.count / max) * 100}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">
              {s.count}
            </span>
            {s.conversionFromStart !== null ? (
              <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:block">
                {s.conversionFromStart}%
              </span>
            ) : (
              <span className="hidden w-16 shrink-0 sm:block" />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Stage-to-stage conversion funnel (Phase 13D §6) — a compact table, not a duplicate visualization. */
export function ConversionFunnelTable({ funnel }: { funnel: CrmFunnelStage[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Stage</th>
            <th className="pb-2 text-right font-medium">Count</th>
            <th className="pb-2 text-right font-medium">From start</th>
            <th className="pb-2 text-right font-medium">From previous</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {funnel.map((s) => (
            <tr key={s.stage}>
              <td className="py-1.5">{STAGE_LABEL[s.stage] ?? s.stage}</td>
              <td className="py-1.5 text-right tabular-nums">{s.count}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {s.conversionFromStart !== null ? `${s.conversionFromStart}%` : '—'}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {s.conversionFromPrevious !== null ? `${s.conversionFromPrevious}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        “From start” is this stage’s count as a share of New leads; “from previous” is the share
        that advanced from the prior stage. Disqualified leads are excluded from the funnel.
      </p>
    </div>
  );
}
