'use client';

import Link from 'next/link';
import { Building2, CheckCircle2, Layers, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/admin/ui';
import { StatCard, ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { usePlatformOverview, usePlatformTenants } from '@/lib/platform/use-platform';

export default function PlatformOverviewPage() {
  const overview = usePlatformOverview();
  const tenants = usePlatformTenants();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="Aivoryx workspaces and the product modules provisioned to each."
      />

      {overview.isLoading ? (
        <LoadingBlock />
      ) : overview.error ? (
        <ErrorBlock error={overview.error} onRetry={() => overview.refetch()} />
      ) : overview.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Companies"
              value={overview.data.tenantCount}
              icon={<Building2 className="size-4" />}
            />
            <StatCard
              label="Active"
              value={overview.data.activeTenantCount}
              icon={<CheckCircle2 className="size-4" />}
            />
            <StatCard
              label="Modules in catalogue"
              value={overview.data.moduleCount}
              icon={<Layers className="size-4" />}
            />
            <StatCard
              label="Suspended"
              value={overview.data.tenantCount - overview.data.activeTenantCount}
            />
          </div>

          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Module adoption</h2>
              <span className="text-xs text-muted-foreground">
                enabled workspaces / {overview.data.tenantCount}
              </span>
            </div>
            <ModuleAdoption />
          </section>

          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Companies</h2>
              <Link
                href="/platform/tenants"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Manage all
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
            {tenants.isLoading ? (
              <div className="p-4">
                <LoadingBlock lines={3} />
              </div>
            ) : tenants.data && tenants.data.length > 0 ? (
              <ul className="divide-y">
                {tenants.data.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/platform/tenants/${t.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-accent/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t.slug} · {t.memberCount} member{t.memberCount === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t.enabledModuleCount} module{t.enabledModuleCount === 1 ? '' : 's'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">No companies yet.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function ModuleAdoption() {
  const tenants = usePlatformTenants();
  const overview = usePlatformOverview();
  if (!tenants.data || !overview.data)
    return (
      <div className="p-4">
        <LoadingBlock lines={3} />
      </div>
    );

  // The overview endpoint returns per-tenant counts, not per-module — so show a
  // catalogue list with a simple enabled-count derived from tenant detail is not
  // available here without N calls. Present the catalogue with its dependencies.
  return (
    <ul className="divide-y">
      {overview.data.modules
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((m) => (
          <li key={m.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{m.displayName}</span>
              <span className="ml-2 text-xs text-muted-foreground">{m.capabilitySummary}</span>
            </span>
            {m.dependencies.length > 0 ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                needs {m.dependencies.join(', ')}
              </span>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">standalone</span>
            )}
          </li>
        ))}
    </ul>
  );
}
