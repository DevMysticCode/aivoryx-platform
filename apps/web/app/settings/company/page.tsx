'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { UpdateCompanyProfileRequest } from '@aivoryx/contracts';
import { Card, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import {
  useCompanyProfile,
  useTenantPlan,
  useUpdateCompanyProfile,
} from '@/lib/settings/use-settings';

type Draft = Record<string, string>;

const TEXT_FIELDS: { key: keyof UpdateCompanyProfileRequest; label: string; hint?: string }[] = [
  { key: 'legalName', label: 'Legal name' },
  { key: 'displayName', label: 'Display name', hint: 'Shown in the app and on documents.' },
  { key: 'email', label: 'Company email' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website' },
  { key: 'addressLine', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'State / region' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  {
    key: 'taxRegistrationLabel',
    label: 'Tax registration label',
    hint: 'e.g. VAT, GST, ABN, EIN.',
  },
  { key: 'taxRegistrationNumber', label: 'Tax registration number' },
  { key: 'timezone', label: 'Timezone', hint: 'IANA name, e.g. Europe/London.' },
  { key: 'defaultCurrency', label: 'Default currency', hint: '3-letter ISO code, e.g. GBP.' },
];

export default function CompanySettingsPage() {
  const perms = usePermissions();
  const canRead = perms.includes('settings.company.read');
  const canEdit = perms.includes('settings.company.update');

  const profile = useCompanyProfile();
  const plan = useTenantPlan();
  const save = useUpdateCompanyProfile();

  const [draft, setDraft] = useState<Draft>({});

  const data = profile.data;
  useEffect(() => {
    if (!data) return;
    const next: Draft = {};
    for (const { key } of TEXT_FIELDS) next[key] = (data[key as keyof typeof data] as string) ?? '';
    setDraft(next);
  }, [data]);

  const patch = useMemo<UpdateCompanyProfileRequest>(() => {
    const body: Draft = {};
    // Only send fields that have a value — the API validates each supplied
    // field (e.g. `email` must be a valid address), so an empty string would be
    // rejected. `documentFooter` has no format rules, so an empty value there
    // is allowed through to clear it.
    for (const { key } of TEXT_FIELDS) {
      const v = draft[key]?.trim() ?? '';
      if (v) body[key] = v;
    }
    return body as unknown as UpdateCompanyProfileRequest;
  }, [draft]);

  if (!canRead) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm">
        <p className="font-medium">You don’t have access to company settings.</p>
        <p className="mt-1 text-muted-foreground">
          Ask a workspace administrator for the “View company profile” permission.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company profile"
        description="Your company details, shown in the app, on your documents and in notification emails."
      >
        {canEdit ? (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate(patch)}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        ) : null}
      </PageHeader>

      <p className="text-sm text-muted-foreground">
        Looking for your logo, colours or how documents look?{' '}
        <Link href="/settings/branding" className="font-medium text-primary hover:underline">
          Open branding &amp; themes
        </Link>
        .
      </p>

      {profile.isLoading ? <Skeleton rows={6} /> : null}
      {profile.error ? <ErrorNote error={profile.error} /> : null}
      {save.error ? <ErrorNote error={save.error} /> : null}

      {data ? (
        <div className="max-w-3xl">
          <div className="space-y-6">
            {/* Plan & usage */}
            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Plan &amp; usage</h2>
              {plan.isLoading ? (
                <Skeleton rows={2} />
              ) : plan.error ? (
                <ErrorNote error={plan.error} />
              ) : plan.data ? (
                <div className="space-y-3">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Solution</p>
                      <p className="text-sm font-medium">{plan.data.solutionName ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Plan</p>
                      <p className="text-sm font-medium">{plan.data.planName ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="text-sm font-medium capitalize">
                        {plan.data.subscriptionStatus ?? 'No subscription on record'}
                      </p>
                    </div>
                  </div>
                  {plan.data.enabledModules.length > 0 ? (
                    <div>
                      <p className="text-xs text-muted-foreground">Enabled modules</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {plan.data.enabledModules.map((m) => (
                          <span
                            key={m.key}
                            className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                          >
                            {m.displayName}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
                    {plan.data.usage.leads !== null ? (
                      <UsageStat label="Leads" value={plan.data.usage.leads} />
                    ) : null}
                    {plan.data.usage.projects !== null ? (
                      <UsageStat label="Projects" value={plan.data.usage.projects} />
                    ) : null}
                    {plan.data.usage.invoices !== null ? (
                      <UsageStat label="Invoices" value={plan.data.usage.invoices} />
                    ) : null}
                    {plan.data.usage.employees !== null ? (
                      <UsageStat label="Employees" value={plan.data.usage.employees} />
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    To change your plan or enabled modules, contact Aivoryx support.
                  </p>
                </div>
              ) : null}
            </Card>

            {/* Company */}
            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Company</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {TEXT_FIELDS.map(({ key, label, hint }) => (
                  <Field
                    key={key}
                    label={label}
                    hint={hint}
                    value={draft[key] ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  />
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
