'use client';

import Link from 'next/link';
import { useVisits } from '@/lib/field/use-field';
import { StatusBadge } from '@/components/admin/ui';
import { WidgetCard, WidgetError, WidgetSkeleton, WidgetStat } from './widget-card';

export function FieldVisitsWidget() {
  const scheduled = useVisits({ status: 'SCHEDULED', pageSize: 5 });
  const assigned = useVisits({ status: 'ASSIGNED', pageSize: 5 });
  const inProgress = useVisits({ status: 'IN_PROGRESS', pageSize: 1 });

  const loading = scheduled.isLoading || assigned.isLoading || inProgress.isLoading;
  const error = scheduled.error ?? assigned.error ?? inProgress.error;
  const upcoming = [...(scheduled.data?.items ?? []), ...(assigned.data?.items ?? [])]
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 5);

  return (
    <WidgetCard title="Field visits" href="/crm/visits" linkLabel="Visits">
      {loading ? (
        <WidgetSkeleton />
      ) : error ? (
        <WidgetError
          onRetry={() => {
            void scheduled.refetch();
            void assigned.refetch();
          }}
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <WidgetStat label="Scheduled" value={scheduled.data?.total ?? 0} />
            <WidgetStat label="Assigned" value={assigned.data?.total ?? 0} />
            <WidgetStat label="In progress" value={inProgress.data?.total ?? 0} tone="warn" />
          </div>
          {upcoming.length > 0 ? (
            <ul className="divide-y">
              {upcoming.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/crm/visits/${v.id}`}
                    className="flex items-center justify-between gap-2 py-2 text-sm hover:opacity-80"
                  >
                    <span className="min-w-0 truncate">
                      {v.leadName ?? 'Visit'}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {new Date(v.scheduledAt).toLocaleDateString()}
                      </span>
                    </span>
                    <StatusBadge status={v.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No upcoming visits.</p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
