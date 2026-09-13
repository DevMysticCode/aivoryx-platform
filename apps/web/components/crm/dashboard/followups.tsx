'use client';

import Link from 'next/link';
import type { CrmFollowupItem, CrmAnalyticsOverview } from '@aivoryx/contracts';

/**
 * The follow-up Action Center (Phase 13D §6) — overdue/due-today/upcoming,
 * each item directly actionable (opens the lead). Real dates only; nothing
 * here is estimated.
 */
export function FollowupActionCenter({
  followups,
}: {
  followups: CrmAnalyticsOverview['followups'];
}) {
  const groups: {
    label: string;
    tone: 'danger' | 'warn' | 'default';
    count: number;
    items: CrmFollowupItem[];
  }[] = [
    { label: 'Overdue', tone: 'danger', count: followups.overdueCount, items: followups.overdue },
    { label: 'Due today', tone: 'warn', count: followups.dueTodayCount, items: followups.dueToday },
    {
      label: 'Upcoming',
      tone: 'default',
      count: followups.upcomingCount,
      items: followups.upcoming,
    },
  ];

  const nothingDue = groups.every((g) => g.count === 0);
  if (nothingDue) {
    return (
      <p className="text-sm text-muted-foreground">No follow-ups pending. You’re all caught up.</p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) =>
        g.count === 0 ? null : (
          <div key={g.label}>
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className={
                  'text-xs font-semibold uppercase tracking-wide ' +
                  (g.tone === 'danger'
                    ? 'text-destructive'
                    : g.tone === 'warn'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground')
                }
              >
                {g.label}
              </span>
              <span className="text-xs text-muted-foreground">({g.count})</span>
            </div>
            <ul className="space-y-1">
              {g.items.map((f) => (
                <li key={f.followupId}>
                  <Link
                    href={`/crm/leads/${f.leadId}`}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
                  >
                    <span className="min-w-0 truncate">{f.leadName ?? 'Unnamed lead'}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {new Date(f.dueAt).toLocaleDateString()}
                      <span className="font-medium text-primary">Open</span>
                    </span>
                  </Link>
                </li>
              ))}
              {g.count > g.items.length ? (
                <li className="px-2 pt-0.5">
                  <Link
                    href="/crm/leads"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    +{g.count - g.items.length} more
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
