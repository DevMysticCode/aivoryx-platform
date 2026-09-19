'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import type { Solution } from '@aivoryx/contracts';
import { PageHeader } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import {
  useCreateTenant,
  usePlans,
  usePlatformModules,
  useSolutions,
} from '@/lib/platform/use-platform';

/**
 * Platform-admin tenant provisioning wizard (Phase 14 §15). Company info →
 * choose solution → review/adjust modules → provision. A solution is only a
 * recommended module preset — the platform admin can still toggle individual
 * modules before provisioning, and the actual authorization boundary
 * afterwards is `tenant_module_entitlements`, not the solution key.
 */

type Step = 'company' | 'solution' | 'review' | 'done';

interface FormState {
  name: string;
  primaryContactName: string;
  timezone: string;
  currency: string;
  adminEmail: string;
  adminName: string;
  solutionKey: string;
  moduleKeys: string[];
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'company', label: 'Company information' },
  { key: 'solution', label: 'Choose solution' },
  { key: 'review', label: 'Review modules' },
  { key: 'done', label: 'Provisioned' },
];

export default function CreateTenantPage() {
  const router = useRouter();
  const solutions = useSolutions();
  const plans = usePlans();
  const modules = usePlatformModules();
  const createTenant = useCreateTenant();

  const [step, setStep] = useState<Step>('company');
  const [form, setForm] = useState<FormState>({
    name: '',
    primaryContactName: '',
    timezone: '',
    currency: '',
    adminEmail: '',
    adminName: '',
    solutionKey: '',
    moduleKeys: [],
  });

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const selectedSolution = solutions.data?.find((s) => s.key === form.solutionKey) ?? null;

  const selectSolution = (s: Solution) => {
    setForm((f) => ({ ...f, solutionKey: s.key, moduleKeys: [...s.moduleKeys] }));
  };

  const toggleModule = (key: string) => {
    setForm((f) => ({
      ...f,
      moduleKeys: f.moduleKeys.includes(key)
        ? f.moduleKeys.filter((m) => m !== key)
        : [...f.moduleKeys, key],
    }));
  };

  const canProceedFromCompany = form.name.trim().length > 0 && form.adminEmail.trim().length > 0;

  const handleProvision = () => {
    createTenant.mutate(
      {
        name: form.name.trim(),
        primaryContactName: form.primaryContactName.trim() || undefined,
        timezone: form.timezone.trim() || undefined,
        currency: form.currency.trim() || undefined,
        adminEmail: form.adminEmail.trim(),
        adminName: form.adminName.trim() || undefined,
        solutionKey: form.solutionKey,
        moduleKeys: form.moduleKeys,
      },
      { onSuccess: () => setStep('done') },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Create a company" description="Provision a new Aivoryx workspace.">
        <Link
          href="/platform/tenants"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to companies
        </Link>
      </PageHeader>

      <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-[11px]',
                i < stepIndex && 'border-primary bg-primary text-primary-foreground',
                i === stepIndex && 'border-primary text-primary font-semibold',
              )}
            >
              {i < stepIndex ? <Check className="size-3" aria-hidden /> : i + 1}
            </span>
            <span className={i === stepIndex ? 'font-medium text-foreground' : undefined}>
              {s.label}
            </span>
            {i < STEPS.length - 1 ? <span aria-hidden>·</span> : null}
          </li>
        ))}
      </ol>

      {step === 'company' ? (
        <section className="space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">
                Company name <span className="text-danger">*</span>
              </span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Acme Field Services"
                className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Primary contact</span>
              <input
                value={form.primaryContactName}
                onChange={(e) => setForm((f) => ({ ...f, primaryContactName: e.target.value }))}
                className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Timezone</span>
              <input
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                placeholder="Asia/Kolkata"
                className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Currency</span>
              <input
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                placeholder="INR"
                className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">
                Admin email <span className="text-danger">*</span>
              </span>
              <input
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                placeholder="admin@acme-field.test"
                className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Admin name</span>
              <input
                value={form.adminName}
                onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
                className="h-9 w-full rounded-md border bg-transparent px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canProceedFromCompany}
              onClick={() => setStep('solution')}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Next: choose solution <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </section>
      ) : null}

      {step === 'solution' ? (
        <section className="space-y-4 rounded-lg border p-4">
          {solutions.isLoading ? (
            <LoadingBlock />
          ) : solutions.error ? (
            <ErrorBlock error={solutions.error} onRetry={() => solutions.refetch()} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {(solutions.data ?? []).map((s) => {
                const plan = plans.data?.find((p) => p.solutionKey === s.key);
                const selected = form.solutionKey === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => selectSolution(s)}
                    className={cn(
                      'rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/40',
                      selected && 'border-primary bg-primary/5',
                    )}
                  >
                    <p className="font-medium">{s.displayName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{s.moduleKeys.join(' · ')}</p>
                    {plan ? (
                      <p className="mt-1 text-xs font-medium text-primary">{plan.displayName}</p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep('company')}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <ArrowLeft className="size-4" aria-hidden /> Back
            </button>
            <button
              type="button"
              disabled={!form.solutionKey}
              onClick={() => setStep('review')}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Next: review modules <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </section>
      ) : null}

      {step === 'review' ? (
        <section className="space-y-4 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            {selectedSolution?.displayName} recommends the highlighted modules. Adjust any module
            for this company — dependencies are still enforced when you provision.
          </p>
          <ul className="divide-y">
            {[...(modules.data ?? [])]
              .sort((a, b) => a.order - b.order)
              .map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {m.displayName}
                    {m.dependencies.length > 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        needs {m.dependencies.join(', ')}
                      </span>
                    ) : null}
                  </span>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.moduleKeys.includes(m.key)}
                      onChange={() => toggleModule(m.key)}
                      className="size-4 rounded border"
                    />
                    <span className="text-xs text-muted-foreground">Enabled</span>
                  </label>
                </li>
              ))}
          </ul>
          {createTenant.isError ? (
            <ErrorBlock error={createTenant.error} onRetry={undefined} />
          ) : null}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep('solution')}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <ArrowLeft className="size-4" aria-hidden /> Back
            </button>
            <button
              type="button"
              disabled={createTenant.isPending || form.moduleKeys.length === 0}
              onClick={handleProvision}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {createTenant.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Provision company
            </button>
          </div>
        </section>
      ) : null}

      {step === 'done' && createTenant.data ? (
        <section className="space-y-4 rounded-lg border p-6 text-center">
          <Check className="mx-auto size-10 rounded-full bg-success-soft p-2 text-success" />
          <div>
            <p className="text-lg font-semibold">{createTenant.data.tenant.name} is live</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {createTenant.data.tenant.enabledModuleCount} modules enabled · status{' '}
              {createTenant.data.tenant.status}
            </p>
          </div>
          <div className="mx-auto max-w-md rounded-md border bg-secondary/30 p-3 text-left text-xs">
            <p className="font-medium">No email provider is configured yet.</p>
            <p className="mt-1 text-muted-foreground">
              Relay this one-time invitation link to {form.adminEmail} out of band:
            </p>
            <code className="mt-2 block break-all rounded bg-background p-2">
              /accept-invitation?token={createTenant.data.invitation.token}
            </code>
          </div>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`/platform/tenants/${createTenant.data!.tenant.id}`)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Open company <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
