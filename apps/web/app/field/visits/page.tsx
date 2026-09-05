'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useVisits } from '@/lib/field/use-field';
import { EmptyState, ErrorNote, Skeleton, StatusBadge } from '@/components/admin/ui';

const STATUSES = ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export default function FieldVisitsPage() {
  const [status, setStatus] = useState('');
  const visits = useVisits({ status: status || undefined, pageSize: 50 });

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">My visits</h1>

      <select
        className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, ' ')}
          </option>
        ))}
      </select>

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
                      {new Date(v.scheduledAt).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={v.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No visits match this filter.</EmptyState>
      )}
    </section>
  );
}
