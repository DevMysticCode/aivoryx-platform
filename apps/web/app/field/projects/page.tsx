'use client';

import Link from 'next/link';
import { useFieldProjects } from '@/lib/execution/use-execution';
import { EmptyState, ErrorNote, Skeleton } from '@/components/admin/ui';
import { SupplyStatusBadge } from '@/components/supply/ui';

export default function FieldProjectsPage() {
  const projects = useFieldProjects();

  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">My installations</h1>

      {projects.isLoading ? (
        <Skeleton rows={4} />
      ) : projects.error ? (
        <ErrorNote error={projects.error} />
      ) : projects.data && projects.data.length > 0 ? (
        <ul className="space-y-3">
          {projects.data.map((p) => (
            <li key={p.projectId}>
              <Link
                href={`/field/projects/${p.projectId}`}
                className="block rounded-lg border p-4 active:bg-accent"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{p.projectNumber}</span>
                  <SupplyStatusBadge status={p.installationStatus} />
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {p.customerName ?? 'Customer'}
                  {p.siteCity ? ` · ${p.siteCity}` : ''}
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span
                    className={
                      p.readinessState === 'READY'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }
                  >
                    Materials: {p.readinessState.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  {p.openDefects > 0 ? (
                    <span className="text-destructive">
                      {p.openDefects} defect{p.openDefects === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No installation work assigned to you.</EmptyState>
      )}
    </section>
  );
}
