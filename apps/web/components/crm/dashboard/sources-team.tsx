'use client';

import type { CrmSourcePerformance, CrmTeamPerformanceRow } from '@aivoryx/contracts';

/**
 * Lead source performance (Phase 13D §6) — generic, driven entirely by the
 * tenant's own configured `lead_sources` plus a "Manual / unattributed"
 * bucket. No source names are ever hardcoded.
 */
export function SourcePerformanceTable({ sources }: { sources: CrmSourcePerformance[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">No leads in this range yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Source</th>
            <th className="pb-2 text-right font-medium">Leads</th>
            <th className="pb-2 text-right font-medium">Qualified</th>
            <th className="pb-2 text-right font-medium">Converted</th>
            <th className="pb-2 text-right font-medium">Conv. rate</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sources.map((s) => (
            <tr key={s.sourceId ?? 'manual'}>
              <td className="py-1.5 font-medium">{s.sourceName}</td>
              <td className="py-1.5 text-right tabular-nums">{s.total}</td>
              <td className="py-1.5 text-right tabular-nums">{s.qualified}</td>
              <td className="py-1.5 text-right tabular-nums">{s.converted}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {s.conversionRate !== null ? `${s.conversionRate}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Team performance (Phase 13D §6/§39) — rendered only when the backend
 * returns a non-null `team` array, i.e. the caller's own data scope is above
 * OWN. There is no client-side permission check to keep in sync: the backend
 * is authoritative, and `team === null` means "do not show this."
 */
export function TeamPerformanceTable({ team }: { team: CrmTeamPerformanceRow[] }) {
  if (team.length === 0) {
    return <p className="text-sm text-muted-foreground">No team activity in this range yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Member</th>
            <th className="pb-2 text-right font-medium">Leads</th>
            <th className="pb-2 text-right font-medium">Qualified</th>
            <th className="pb-2 text-right font-medium">Converted</th>
            <th className="pb-2 text-right font-medium">Pending follow-ups</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {team.map((t) => (
            <tr key={t.membershipId}>
              <td className="py-1.5 font-medium">{t.name ?? t.email}</td>
              <td className="py-1.5 text-right tabular-nums">{t.leads}</td>
              <td className="py-1.5 text-right tabular-nums">{t.qualified}</td>
              <td className="py-1.5 text-right tabular-nums">{t.converted}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {t.pendingFollowups}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
