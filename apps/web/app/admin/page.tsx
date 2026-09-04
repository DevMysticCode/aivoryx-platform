'use client';

import Link from 'next/link';
import { useTenant } from '@/lib/admin/use-admin';
import { Card, ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';

export default function AdminOverviewPage() {
  const tenant = useTenant();

  return (
    <section className="space-y-6">
      <PageHeader
        title="Workspace administration"
        description="Manage your workspace details and the people who can access it."
      />

      {tenant.isLoading ? (
        <Skeleton rows={2} />
      ) : tenant.error ? (
        <ErrorNote error={tenant.error} />
      ) : tenant.data ? (
        <div className="space-y-4">
          <Card className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Workspace</p>
            <p className="text-lg font-semibold">{tenant.data.name}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {tenant.data.slug} · {tenant.data.status}
            </p>
          </Card>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Members" value={tenant.data.memberCounts.total} />
            <Stat label="Active" value={tenant.data.memberCounts.active} />
            <Stat label="Invited" value={tenant.data.memberCounts.invited} />
            <Stat label="Suspended" value={tenant.data.memberCounts.suspended} />
          </dl>

          <p className="text-sm text-muted-foreground">
            Go to{' '}
            <Link href="/admin/members" className="font-medium text-primary hover:underline">
              Members
            </Link>{' '}
            to invite people or manage access, or{' '}
            <Link href="/admin/settings" className="font-medium text-primary hover:underline">
              Workspace settings
            </Link>{' '}
            to edit the workspace name.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </Card>
  );
}
