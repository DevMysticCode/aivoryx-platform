'use client';

import Link from 'next/link';
import type { CrmRecentActivityItem } from '@aivoryx/contracts';

const TYPE_LABEL: Record<string, string> = {
  CALL: 'Call',
  STATUS_CHANGE: 'Status change',
  NOTE: 'Note',
  ASSIGNMENT: 'Assignment',
  FOLLOWUP: 'Follow-up',
  QUALIFICATION: 'Qualification',
};

/** Recent CRM activity feed (Phase 13D §6) — calls, status changes, notes, follow-ups, assignments. */
export function ActivityFeed({ activity }: { activity: CrmRecentActivityItem[] }) {
  if (activity.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity in this range yet.</p>;
  }
  return (
    <ul className="space-y-1">
      {activity.map((a) => (
        <li key={a.id}>
          <Link
            href={`/crm/leads/${a.leadId}`}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium">{TYPE_LABEL[a.type] ?? a.type}</span>
              <span className="text-muted-foreground"> · {a.leadName ?? 'Unnamed lead'}</span>
              {a.actorName ? <span className="text-muted-foreground"> · {a.actorName}</span> : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(a.createdAt).toLocaleDateString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
