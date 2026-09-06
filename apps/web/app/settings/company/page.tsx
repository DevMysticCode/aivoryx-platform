'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { UpdateCompanyProfileRequest } from '@aivoryx/contracts';
import { Card, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import { GuidanceCard } from '@/components/guidance';
import { usePermissions } from '@/components/supply/supply-shell';
import {
  useCompanyProfile,
  useLogoObjectUrl,
  useRemoveLogo,
  useUpdateCompanyProfile,
  useUploadLogo,
} from '@/lib/settings/use-settings';
import { help } from '@/lib/help-content';

const HEX = /^#[0-9a-fA-F]{6}$/;

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
  const save = useUpdateCompanyProfile();
  const upload = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const fileRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft>({});
  const [primary, setPrimary] = useState('#1e40af');
  const [footer, setFooter] = useState('');

  const data = profile.data;
  useEffect(() => {
    if (!data) return;
    const next: Draft = {};
    for (const { key } of TEXT_FIELDS) next[key] = (data[key as keyof typeof data] as string) ?? '';
    setDraft(next);
    setPrimary(data.primaryColor ?? '#1e40af');
    setFooter(data.documentFooter ?? '');
  }, [data]);

  const logoUrl = useLogoObjectUrl(!!data?.hasLogo, data?.updatedAt ?? null);
  const colorValid = HEX.test(primary);

  const displayName = draft.displayName || data?.workspaceName || 'Your company';

  const patch = useMemo<UpdateCompanyProfileRequest>(() => {
    const body: Draft = {};
    for (const { key } of TEXT_FIELDS) body[key] = draft[key]?.trim() ?? '';
    return {
      ...(body as unknown as UpdateCompanyProfileRequest),
      documentFooter: footer.trim(),
      ...(colorValid ? { primaryColor: primary.toLowerCase() } : {}),
    };
  }, [draft, footer, primary, colorValid]);

  if (!canRead) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
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
        title="Company profile & branding"
        description="Your identity across the app, your documents and your notification emails."
      >
        {canEdit ? (
          <button
            type="button"
            disabled={save.isPending || !colorValid}
            onClick={() => save.mutate(patch)}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        ) : null}
      </PageHeader>

      <GuidanceCard title={help('settings-company').title}>
        {help('settings-company').body}
      </GuidanceCard>

      {profile.isLoading ? <Skeleton rows={6} /> : null}
      {profile.error ? <ErrorNote error={profile.error} /> : null}
      {save.error ? <ErrorNote error={save.error} /> : null}

      {data ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-6">
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

            {/* Branding */}
            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Branding</h2>
              <div className="space-y-2">
                <span className="text-sm font-medium">Logo</span>
                <div className="flex items-center gap-4">
                  <div className="grid size-16 place-items-center overflow-hidden rounded-md border bg-secondary/40">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt="Workspace logo"
                        className="size-full object-contain"
                      />
                    ) : (
                      <span className="text-xl font-bold text-muted-foreground">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  {canEdit ? (
                    <div className="space-y-1">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="block text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) upload.mutate({ kind: 'logo', file: f });
                          if (fileRef.current) fileRef.current.value = '';
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        PNG, JPEG or WebP · up to 2 MB · square works best.
                      </p>
                      {data.hasLogo ? (
                        <button
                          type="button"
                          onClick={() => removeLogo.mutate('logo')}
                          className="text-xs font-medium text-destructive hover:underline"
                        >
                          Remove logo
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {upload.error ? <ErrorNote error={upload.error} /> : null}
                {removeLogo.error ? <ErrorNote error={removeLogo.error} /> : null}
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Primary brand colour</span>
                <span className="flex items-center gap-3">
                  <input
                    type="color"
                    value={colorValid ? primary : '#1e40af'}
                    disabled={!canEdit}
                    onChange={(e) => setPrimary(e.target.value)}
                    className="h-9 w-14 rounded border bg-transparent"
                    aria-label="Primary brand colour"
                  />
                  <input
                    type="text"
                    value={primary}
                    disabled={!canEdit}
                    onChange={(e) => setPrimary(e.target.value)}
                    className="h-9 w-32 rounded-md border border-input bg-transparent px-3 font-mono text-sm"
                  />
                </span>
                {!colorValid ? (
                  <span className="text-xs text-destructive">
                    Enter a 6-digit hex value such as #1E40AF.
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Applied to buttons and highlights. Contrast is protected automatically.
                  </span>
                )}
              </label>
            </Card>

            {/* Documents */}
            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Documents</h2>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Document footer</span>
                <textarea
                  value={footer}
                  disabled={!canEdit}
                  maxLength={500}
                  rows={2}
                  onChange={(e) => setFooter(e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  placeholder="Bank details, payment terms, registration lines…"
                />
                <span className="text-xs text-muted-foreground">
                  Shown at the bottom of every generated PDF, alongside “Powered by Aivoryx™”.
                </span>
              </label>
            </Card>
          </div>

          {/* Live preview */}
          <aside className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            <div className="overflow-hidden rounded-lg border">
              <div className="h-1.5" style={{ background: colorValid ? primary : '#1e40af' }} />
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <div className="grid size-8 place-items-center overflow-hidden rounded-md border bg-secondary/40">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="size-full object-contain" />
                    ) : (
                      <span className="text-sm font-bold text-muted-foreground">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span className="truncate text-sm font-semibold">{displayName}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {draft.addressLine || 'Address line'}
                  <br />
                  {[draft.city, draft.region, draft.postalCode].filter(Boolean).join(', ') ||
                    'City, region, postcode'}
                </div>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: colorValid ? primary : '#1e40af' }}
                >
                  Primary action
                </button>
                <p className="border-t pt-2 text-[10px] text-muted-foreground">
                  {footer.trim() ? `${footer.trim()} · ` : ''}Powered by Aivoryx™
                </p>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
