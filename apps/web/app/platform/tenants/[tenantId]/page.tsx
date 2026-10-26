'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
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
  useResumeProvisioning,
  useSetTenantModule,
  useSuspendTenant,
  useTenantReadiness,
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
  const readiness = useTenantReadiness(tenantId);
  const setModule = useSetTenantModule(tenantId);
  const activate = useActivateTenant(tenantId);
  const suspend = useSuspendTenant(tenantId);
  const archive = useArchiveTenant(tenantId);
  const resume = useResumeProvisioning(tenantId);
  const toast = useToast();
  const [confirm, setConfirm] = useState<{
    module: PlatformTenantModule;
    next: 'ENABLED' | 'DISABLED';
  } | null>(null);
  const [lifecycleConfirm, setLifecycleConfirm] = useState<TenantStatus | null>(null);
  const [resumeForm, setResumeForm] = useState({
    adminEmail: '',
    adminName: '',
    planKey: '',
    moduleKeys: [] as string[],
  });

  const modules = (tenant.data?.modules ?? []).slice().sort((a, b) => a.order - b.order);
  const enabledKeys = new Set(modules.filter((m) => m.state === 'ENABLED').map((m) => m.key));

  // Seed the resume form's module selection from whatever already got
  // provisioned, once, the first time this stuck tenant's data loads.
  const enabledKeysSignature = [...enabledKeys].sort().join(',');
  useEffect(() => {
    if (tenant.data?.status === 'provisioning' && enabledKeys.size > 0) {
      setResumeForm((f) => (f.moduleKeys.length > 0 ? f : { ...f, moduleKeys: [...enabledKeys] }));
    }
  }, [tenant.data?.status, enabledKeysSignature]);

  const toggleResumeModule = (key: string) => {
    setResumeForm((f) => ({
      ...f,
      moduleKeys: f.moduleKeys.includes(key)
        ? f.moduleKeys.filter((m) => m !== key)
        : [...f.moduleKeys, key],
    }));
  };

  const handleResume = async () => {
    try {
      await resume.mutateAsync({
        adminEmail: resumeForm.adminEmail.trim(),
        adminName: resumeForm.adminName.trim() || undefined,
        planKey: resumeForm.planKey.trim() || undefined,
        moduleKeys: resumeForm.moduleKeys,
      });
      toast.success(`${tenant.data?.name} provisioning finished — now active.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not finish provisioning.');
    }
  };

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
                        ? 'hover:bg-danger-soft hover:text-danger'
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

          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Onboarding</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Derived from this workspace&apos;s own data — there is nothing to mark done by hand.
            </p>
            {readiness.isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : readiness.data ? (
              <ul className="mt-3 space-y-2">
                {readiness.data.steps.map((s) => (
                  <li key={s.key} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full',
                        s.done ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {s.done ? <Check className="size-3.5" aria-hidden /> : null}
                    </span>
                    <span className={s.done ? 'text-foreground' : 'text-muted-foreground'}>
                      {s.title}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {tenant.data.status === 'provisioning' ? (
            <section className="rounded-lg border border-warning/40 bg-warning-soft/30 p-4">
              <h2 className="text-sm font-semibold">Finish provisioning</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This workspace did not finish setting up in one pass — a step after its company
                record was created (modules, subscription, or the admin invitation) did not
                complete. Nothing here was lost: pick up where it left off. This is safe to submit
                more than once.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">
                    Admin email <span className="text-danger">*</span>
                  </span>
                  <input
                    type="email"
                    value={resumeForm.adminEmail}
                    onChange={(e) => setResumeForm((f) => ({ ...f, adminEmail: e.target.value }))}
                    placeholder="admin@acme-field.test"
                    className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Admin name</span>
                  <input
                    value={resumeForm.adminName}
                    onChange={(e) => setResumeForm((f) => ({ ...f, adminName: e.target.value }))}
                    className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                {!tenant.data.subscription ? (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">
                      Plan key <span className="text-danger">*</span>
                    </span>
                    <input
                      value={resumeForm.planKey}
                      onChange={(e) => setResumeForm((f) => ({ ...f, planKey: e.target.value }))}
                      placeholder="AIVORYX_SOLAR"
                      className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                ) : null}
              </div>
              <fieldset className="mt-3">
                <legend className="text-sm font-medium">Modules</legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {modules.map((m) => (
                    <label key={m.key} className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={resumeForm.moduleKeys.includes(m.key)}
                        onChange={() => toggleResumeModule(m.key)}
                        className="size-4 rounded border"
                      />
                      {m.displayName}
                    </label>
                  ))}
                </div>
              </fieldset>
              {resume.isError ? <ErrorBlock error={resume.error} onRetry={undefined} /> : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={
                    resume.isPending ||
                    !resumeForm.adminEmail.trim() ||
                    resumeForm.moduleKeys.length === 0 ||
                    (!tenant.data.subscription && !resumeForm.planKey.trim())
                  }
                  onClick={handleResume}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  Finish provisioning
                </button>
              </div>
              {resume.data?.invitation ? (
                <div className="mt-3 rounded-md border bg-secondary/30 p-3 text-left text-xs">
                  <p className="font-medium">No email provider is configured yet.</p>
                  <p className="mt-1 text-muted-foreground">
                    Relay this one-time invitation link to {resumeForm.adminEmail} out of band:
                  </p>
                  <code className="mt-2 block break-all rounded bg-background p-2">
                    /accept-invitation?token={resume.data.invitation.token}
                  </code>
                </div>
              ) : null}
            </section>
          ) : null}

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
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-warning">
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
                          ? 'hover:bg-danger-soft hover:text-danger'
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
