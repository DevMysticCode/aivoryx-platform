'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { ArrowLeft, Check, Lock } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { nextTenantStatuses, type TenantStatus } from '@aivoryx/shared';
import { ApiError } from '@/lib/api/client';
import { PageHeader, StatusBadge } from '@/components/admin/ui';
import { StatCard, ErrorBlock, LoadingBlock, Confirm } from '@/components/ui/kit';
import { useToast } from '@/components/ui/toast';
import {
  useActivateTenant,
  useArchiveTenant,
  usePlatformTenant,
  useSetTenantModule,
  useSuspendTenant,
  useTenantUsage,
} from '@/lib/platform/use-platform';
import type { PlatformTenantModule } from '@aivoryx/contracts';

/** A tenant never transitions back to 'provisioning' — only forward actions apply. */
const LIFECYCLE_ACTION_LABEL: Partial<Record<TenantStatus, string>> = {
  active: 'Activate',
  suspended: 'Suspend',
  archived: 'Archive',
};

export default function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const tenant = usePlatformTenant(tenantId);
  const usage = useTenantUsage(tenantId);
  const setModule = useSetTenantModule(tenantId);
  const activate = useActivateTenant(tenantId);
  const suspend = useSuspendTenant(tenantId);
  const archive = useArchiveTenant(tenantId);
  const toast = useToast();
  const [confirm, setConfirm] = useState<{
    module: PlatformTenantModule;
    next: 'ENABLED' | 'DISABLED';
  } | null>(null);
  const [lifecycleConfirm, setLifecycleConfirm] = useState<TenantStatus | null>(null);

  const modules = (tenant.data?.modules ?? []).slice().sort((a, b) => a.order - b.order);
  const enabledKeys = new Set(modules.filter((m) => m.state === 'ENABLED').map((m) => m.key));

  const apply = async (module: PlatformTenantModule, next: 'ENABLED' | 'DISABLED') => {
    try {
      await setModule.mutateAsync({ moduleKey: module.key, state: next });
      toast.success(`${module.displayName} ${next === 'ENABLED' ? 'enabled' : 'disabled'}`);
      setConfirm(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ENTITLEMENT_DEPENDENCY_UNMET') {
        const missing = (err.body?.error.details as { missing?: string[] })?.missing ?? [];
        toast.error(
          `Cannot enable ${module.displayName}: needs ${missing.join(', ')} enabled first.`,
        );
      } else if (err instanceof ApiError && err.code === 'ENTITLEMENT_DEPENDANT_ENABLED') {
        const dependants = (err.body?.error.details as { dependants?: string[] })?.dependants ?? [];
        toast.error(
          `Cannot disable ${module.displayName}: ${dependants.join(', ')} still depend${
            dependants.length === 1 ? 's' : ''
          } on it.`,
        );
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not update the module.');
      }
      setConfirm(null);
    }
  };

  const onToggle = (module: PlatformTenantModule) => {
    const next = module.state === 'ENABLED' ? 'DISABLED' : 'ENABLED';
    if (next === 'DISABLED') {
      setConfirm({ module, next });
    } else {
      void apply(module, next);
    }
  };

  const lifecycleMutation = (to: TenantStatus) =>
    to === 'active' ? activate : to === 'suspended' ? suspend : archive;

  const applyLifecycle = async (to: TenantStatus) => {
    try {
      await lifecycleMutation(to).mutateAsync(undefined);
      toast.success(`${tenant.data?.name} is now ${to}.`);
      setLifecycleConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the workspace status.');
      setLifecycleConfirm(null);
    }
  };

  const onLifecycleAction = (to: TenantStatus) => {
    if (to === 'suspended' || to === 'archived') {
      setLifecycleConfirm(to);
    } else {
      void applyLifecycle(to);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        href="/platform/tenants"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Companies
      </Link>

      {tenant.isLoading ? (
        <LoadingBlock />
      ) : tenant.error ? (
        <ErrorBlock error={tenant.error} onRetry={() => tenant.refetch()} />
      ) : tenant.data ? (
        <>
          <PageHeader title={tenant.data.name} description={tenant.data.slug}>
            <div className="flex items-center gap-2">
              <StatusBadge status={tenant.data.status} />
              {nextTenantStatuses(tenant.data.status)
                .filter((s) => s !== 'provisioning')
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onLifecycleAction(s)}
                    disabled={activate.isPending || suspend.isPending || archive.isPending}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50',
                      s === 'archived'
                        ? 'hover:bg-destructive/10 hover:text-destructive'
                        : 'hover:bg-primary/10 hover:text-primary',
                    )}
                  >
                    {LIFECYCLE_ACTION_LABEL[s]}
                  </button>
                ))}
            </div>
          </PageHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Members" value={tenant.data.memberCount} />
            <StatCard
              label="Modules enabled"
              value={tenant.data.enabledModuleCount}
              hint={`of ${modules.length}`}
            />
            <StatCard
              label="Created"
              value={new Date(tenant.data.createdAt).toLocaleDateString()}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-lg border p-4">
              <h2 className="text-sm font-semibold">Subscription</h2>
              {tenant.data.subscription ? (
                <div className="mt-2 space-y-1 text-sm">
                  <p className="font-medium">{tenant.data.subscription.planKey}</p>
                  <p className="text-xs text-muted-foreground">
                    {tenant.data.subscription.status} · since{' '}
                    {new Date(tenant.data.subscription.startedAt).toLocaleDateString()}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No subscription on record.</p>
              )}
            </section>
            <section className="rounded-lg border p-4">
              <h2 className="text-sm font-semibold">Usage</h2>
              {usage.isLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
              ) : usage.data ? (
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  {(
                    [
                      ['Leads', usage.data.leads],
                      ['Projects', usage.data.projects],
                      ['Invoices', usage.data.invoices],
                      ['Employees', usage.data.employees],
                    ] as const
                  ).map(([label, value]) =>
                    value === null ? null : (
                      <div key={label}>
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">{value}</dd>
                      </div>
                    ),
                  )}
                </dl>
              ) : null}
            </section>
          </div>

          <section className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Module entitlements</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Enabling a module requires its dependencies. Disabling is blocked while another
                enabled module depends on it — Aivoryx never cascades a disable.
              </p>
            </div>
            <ul className="divide-y">
              {modules.map((m) => {
                const missingDeps = m.dependencies.filter((d) => !enabledKeys.has(d));
                const blockingDependants = modules
                  .filter((x) => x.state === 'ENABLED' && x.dependencies.includes(m.key))
                  .map((x) => x.displayName);
                const canEnable = m.state === 'DISABLED' && missingDeps.length === 0;
                const canDisable = m.state === 'ENABLED' && blockingDependants.length === 0;
                const busy = setModule.isPending && setModule.variables?.moduleKey === m.key;
                return (
                  <li
                    key={m.key}
                    data-testid={`module-${m.key}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.displayName}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                            m.state === 'ENABLED'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {m.state}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                      {m.dependencies.length > 0 ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Depends on {m.dependencies.join(', ')}
                          {missingDeps.length > 0 && m.state === 'DISABLED'
                            ? ` — enable ${missingDeps.join(', ')} first`
                            : ''}
                        </p>
                      ) : null}
                      {m.state === 'ENABLED' && blockingDependants.length > 0 ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <Lock className="size-3" aria-hidden />
                          {blockingDependants.join(', ')} depend
                          {blockingDependants.length === 1 ? 's' : ''} on this
                        </p>
                      ) : null}
                      {m.enabledAt && m.state === 'ENABLED' ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Enabled {new Date(m.enabledAt).toLocaleDateString()}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={busy || (!canEnable && !canDisable)}
                      onClick={() => onToggle(m)}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
                        m.state === 'ENABLED'
                          ? 'hover:bg-destructive/10 hover:text-destructive'
                          : 'hover:bg-primary/10 hover:text-primary',
                      )}
                    >
                      {m.state === 'ENABLED' ? (
                        'Disable'
                      ) : (
                        <>
                          <Check className="size-3.5" aria-hidden /> Enable
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}

      <Confirm
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && apply(confirm.module, confirm.next)}
        title={`Disable ${confirm?.module.displayName}?`}
        confirmLabel="Disable module"
        danger
        pending={setModule.isPending}
        body={
          <>
            Users in <strong>{tenant.data?.name}</strong> will immediately lose access to{' '}
            {confirm?.module.displayName} features and its API. Their profiles and permission sets
            are kept — re-enabling restores access.
          </>
        }
      />

      <Confirm
        open={!!lifecycleConfirm}
        onClose={() => setLifecycleConfirm(null)}
        onConfirm={() => lifecycleConfirm && applyLifecycle(lifecycleConfirm)}
        title={`${lifecycleConfirm ? LIFECYCLE_ACTION_LABEL[lifecycleConfirm] : ''} ${tenant.data?.name}?`}
        confirmLabel={lifecycleConfirm ? LIFECYCLE_ACTION_LABEL[lifecycleConfirm] : 'Confirm'}
        danger
        pending={suspend.isPending || archive.isPending}
        body={
          lifecycleConfirm === 'archived' ? (
            <>
              Users in <strong>{tenant.data?.name}</strong> will no longer be able to sign in or use
              the workspace. Data is preserved — this is not reversible from here yet.
            </>
          ) : (
            <>
              Users in <strong>{tenant.data?.name}</strong> will no longer be able to sign in or use
              the workspace until it is reactivated. Data is preserved.
            </>
          )
        }
      />
    </div>
  );
}
