'use client';

import Link from 'next/link';
import { useVisits } from '@/lib/field/use-field';
import { EmptyState, ErrorNote, Skeleton, StatusBadge } from '@/components/admin/ui';

/**
 * "Today" — the field agent's primary landing view. Server-side visibility
 * already restricts this to the caller's own assigned visits (ADR 0033 §4);
 * no client-side assignee filter is needed or trusted.
 */
export default function FieldTodayPage() {
  const visits = useVisits({ today: true, pageSize: 50 });

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">Today&rsquo;s visits</h1>

      {visits.isLoading ? (
        <Skeleton rows={4} />
      ) : visits.error ? (
        <ErrorNote error={visits.error} />
      ) : visits.data && visits.data.items.length > 0 ? (
        <ul className="space-y-3">
          {visits.data.items.map((v) => (
            <li key={v.id}>
              <Link
                href={`/field/visits/${v.id}`}
                className="block rounded-lg border p-4 active:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{v.leadName ?? v.leadPhone ?? 'Site visit'}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(v.scheduledAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <StatusBadge status={v.status} />
                </div>
                {v.addressLine ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {v.addressLine}
                    {v.city ? `, ${v.city}` : ''}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No visits scheduled for today.</EmptyState>
      )}
    </section>
  );
}
