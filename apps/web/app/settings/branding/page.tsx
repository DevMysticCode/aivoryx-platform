'use client';

import { useEffect, useMemo, useState } from 'react';
import type { UpdateCompanyProfileRequest } from '@aivoryx/contracts';
import { Button } from '@aivoryx/ui';
import {
  THEME_PRESETS,
  type ThemePresetKey,
  deriveTheme,
  documentAccent,
  isHexColor,
  isThemePresetKey,
  resolveThemeColors,
} from '@aivoryx/shared';
import { Card, ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { Confirm } from '@/components/ui/kit';
import { HelperText } from '@/components/help/helper-text';
import { InfoPopover } from '@/components/help/info-popover';
import { ThemePicker, type ThemeDraft } from '@/components/branding/theme-picker';
import { LogoSlot } from '@/components/branding/logo-slot';
import { BrandingPreview } from '@/components/branding/branding-preview';
import { usePermissions } from '@/components/supply/supply-shell';
import { useAppearance } from '@/components/theme-provider';
import { useMe } from '@/lib/admin/use-admin';
import {
  useCompanyProfile,
  useLogoObjectUrl,
  useUpdateCompanyProfile,
} from '@/lib/settings/use-settings';

interface Draft {
  theme: ThemeDraft;
  documentLogoMode: 'company' | 'separate';
  documentAccent: string;
  footer: string;
  showCustomerLogo: boolean;
  loginWelcome: string;
  loginDescription: string;
  loginShowPoweredBy: boolean;
}

const DEFAULT_THEME: ThemeDraft = {
  preset: 'aivoryx-teal',
  colors: { ...THEME_PRESETS[0]!.colors },
};

function initialDraft(
  d: {
    themePreset?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
    documentLogoMode?: string;
    documentAccentColor?: string | null;
    documentFooter?: string | null;
    documentShowCustomerLogo?: boolean;
    loginWelcome?: string | null;
    loginDescription?: string | null;
    loginShowPoweredBy?: boolean;
  } | null,
): Draft {
  const stored = d?.themePreset && isThemePresetKey(d.themePreset) ? d.themePreset : null;
  const preset: ThemePresetKey = stored ?? (d?.primaryColor ? 'custom' : 'aivoryx-teal');
  const colors = resolveThemeColors({
    preset: preset === 'custom' ? null : preset,
    primary: d?.primaryColor,
    secondary: d?.secondaryColor,
    accent: d?.accentColor,
  });
  return {
    theme: { preset, colors },
    documentLogoMode: d?.documentLogoMode === 'separate' ? 'separate' : 'company',
    documentAccent: d?.documentAccentColor ?? '',
    footer: d?.documentFooter ?? '',
    showCustomerLogo: !!d?.documentShowCustomerLogo,
    loginWelcome: d?.loginWelcome ?? '',
    loginDescription: d?.loginDescription ?? '',
    loginShowPoweredBy: d?.loginShowPoweredBy ?? true,
  };
}

export default function BrandingSettingsPage() {
  const perms = usePermissions();
  const canRead = perms.includes('settings.company.read');
  const canEdit = perms.includes('settings.company.update');
  const appearance = useAppearance();

  const profile = useCompanyProfile();
  const save = useUpdateCompanyProfile();
  const data = profile.data;

  const [draft, setDraft] = useState<Draft>(() => initialDraft(null));
  const [baseline, setBaseline] = useState<Draft>(() => initialDraft(null));
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>(appearance.resolved);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!data) return;
    const next = initialDraft(data);
    setDraft(next);
    setBaseline(next);
  }, [data]);

  const me = useMe();
  const slug = me.data?.active?.membership.tenantSlug ?? null;
  const [copied, setCopied] = useState(false);
  const cacheKey = data?.updatedAt ?? null;
  const displayName = data?.displayName || data?.workspaceName || 'Your company';
  const logoUrl = useLogoObjectUrl(!!data?.hasLogo, cacheKey, 'logo');
  const loginLogoUrl = useLogoObjectUrl(!!data?.hasLoginLogo, cacheKey, 'logo_login');
  const docLogoUrl = useLogoObjectUrl(
    !!data?.hasDocumentLogo && draft.documentLogoMode === 'separate',
    cacheKey,
    'logo_document',
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const allHex = (['primary', 'secondary', 'accent'] as const).every((k) =>
    isHexColor(draft.theme.colors[k]),
  );
  const contrast = useMemo(() => deriveTheme(draft.theme.colors).report, [draft.theme.colors]);
  const docAccentValid = draft.documentAccent === '' || isHexColor(draft.documentAccent);
  const valid = allHex && contrast.ok && docAccentValid;

  const patch = useMemo<UpdateCompanyProfileRequest>(() => {
    const body: Record<string, unknown> = {
      themePreset: draft.theme.preset,
      documentLogoMode: draft.documentLogoMode,
      documentShowCustomerLogo: draft.showCustomerLogo,
      documentFooter: draft.footer.trim(),
      loginWelcome: draft.loginWelcome.trim(),
      loginDescription: draft.loginDescription.trim(),
      loginShowPoweredBy: draft.loginShowPoweredBy,
    };
    if (draft.theme.preset === 'custom') {
      body.primaryColor = draft.theme.colors.primary.toLowerCase();
      body.secondaryColor = draft.theme.colors.secondary.toLowerCase();
      body.accentColor = draft.theme.colors.accent.toLowerCase();
    }
    if (draft.documentAccent && draft.documentAccent !== baseline.documentAccent) {
      body.documentAccentColor = draft.documentAccent.toLowerCase();
    }
    return body as UpdateCompanyProfileRequest;
  }, [draft, baseline.documentAccent]);

  if (!canRead) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm">
        <p className="font-medium">You don’t have access to branding settings.</p>
        <p className="mt-1 text-muted-foreground">
          Ask a workspace administrator for the “View company profile” permission.
        </p>
      </div>
    );
  }

  const effectiveDocAccent = documentAccent(draft.documentAccent || draft.theme.colors.primary);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding & themes"
        description="How your workspace and your documents look. Changes never affect security, tenancy or permissions."
      >
        {canEdit ? (
          <>
            <Button
              variant="ghost"
              disabled={!dirty || save.isPending}
              onClick={() => setDraft(baseline)}
            >
              Cancel
            </Button>
            <Button
              isLoading={save.isPending}
              loadingText="Saving…"
              disabled={!dirty || !valid}
              onClick={() => save.mutate(patch)}
            >
              Save changes
            </Button>
          </>
        ) : null}
      </PageHeader>

      {profile.isLoading ? <Skeleton rows={6} /> : null}
      {profile.error ? <ErrorNote error={profile.error} /> : null}
      {save.error ? <ErrorNote error={save.error} /> : null}

      {data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Card className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  Theme
                  <InfoPopover label="About themes">
                    <p>
                      A theme sets your brand colours. Status colours (success, warning, danger,
                      info) never change, so their meaning is always clear.
                    </p>
                  </InfoPopover>
                </h2>
                {canEdit ? (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                    Reset to Aivoryx default
                  </Button>
                ) : null}
              </div>
              <ThemePicker
                value={draft.theme}
                disabled={!canEdit}
                onChange={(theme) => setDraft((d) => ({ ...d, theme }))}
              />
            </Card>

            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Logos</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <LogoSlot
                  kind="logo"
                  label="Primary logo"
                  hint="Shown in the sidebar and on documents. PNG, JPEG or WebP, up to 2 MB."
                  present={data.hasLogo}
                  cacheKey={cacheKey}
                  canEdit={canEdit}
                  fallback={displayName}
                />
                <LogoSlot
                  kind="logo_compact"
                  label="Compact logo"
                  hint="A square mark for the collapsed sidebar."
                  present={!!data.hasCompactLogo}
                  cacheKey={cacheKey}
                  canEdit={canEdit}
                  fallback={displayName}
                />
                <LogoSlot
                  kind="logo_light"
                  label="Light-mode logo"
                  hint="Optional. Used instead of the primary logo in light mode."
                  present={data.hasLightLogo}
                  cacheKey={cacheKey}
                  canEdit={canEdit}
                  fallback={displayName}
                />
                <LogoSlot
                  kind="logo_dark"
                  label="Dark-mode logo"
                  hint="Optional. Used instead of the primary logo in dark mode."
                  present={data.hasDarkLogo}
                  cacheKey={cacheKey}
                  canEdit={canEdit}
                  fallback={displayName}
                />
                <LogoSlot
                  kind="favicon"
                  label="Favicon"
                  hint="The browser-tab icon. A square image works best."
                  present={data.hasFavicon}
                  cacheKey={cacheKey}
                  canEdit={canEdit}
                  fallback={displayName}
                />
                <LogoSlot
                  kind="logo_login"
                  label="Sign-in logo"
                  hint="Optional. Shown on your workspace sign-in page instead of the primary logo."
                  present={!!data.hasLoginLogo}
                  cacheKey={cacheKey}
                  canEdit={canEdit}
                  fallback={displayName}
                />
              </div>
              <HelperText>
                Images are checked when uploaded and are private to your workspace.
              </HelperText>
            </Card>

            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Sign-in page</h2>
              <p className="-mt-2 text-xs text-muted-foreground">
                Shown when people open your workspace sign-in link. Everyone still signs in with the
                same Aivoryx account &mdash; this only changes how the page looks.
              </p>
              {slug ? (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Your sign-in link</span>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      aria-label="Workspace sign-in link"
                      value={`${typeof window === 'undefined' ? '' : window.location.origin}/login?workspace=${slug}`}
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background-muted px-2.5 font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            `${window.location.origin}/login?workspace=${slug}`,
                          );
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        } catch {
                          /* clipboard unavailable: the field is selectable */
                        }
                      }}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <HelperText>
                    Without this link the sign-in page shows neutral Aivoryx branding.
                  </HelperText>
                </div>
              ) : null}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Welcome message</span>
                <input
                  value={draft.loginWelcome}
                  disabled={!canEdit}
                  maxLength={80}
                  placeholder="Sign in"
                  onChange={(e) => setDraft((d) => ({ ...d, loginWelcome: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm placeholder:text-subtle"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Description</span>
                <textarea
                  value={draft.loginDescription}
                  disabled={!canEdit}
                  maxLength={240}
                  rows={2}
                  placeholder={`Sign in to ${displayName}.`}
                  onChange={(e) => setDraft((d) => ({ ...d, loginDescription: e.target.value }))}
                  className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm placeholder:text-subtle"
                />
                <HelperText>Plain text only. Leave both blank to use the defaults.</HelperText>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={!canEdit}
                  checked={draft.loginShowPoweredBy}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, loginShowPoweredBy: e.target.checked }))
                  }
                />
                <span className="font-medium">
                  Show &ldquo;Powered by Aivoryx&rdquo; on the sign-in page
                </span>
              </label>
            </Card>

            <Card className="space-y-5">
              <h2 className="text-sm font-semibold">Documents</h2>
              <p className="-mt-3 text-xs text-muted-foreground">
                Applies to every generated PDF — quotations, invoices, receipts, credit notes and
                more.
              </p>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Logo on documents</legend>
                {(
                  [
                    ['company', 'Use company branding', 'Your primary logo.'],
                    [
                      'separate',
                      'Use a separate document logo',
                      'For example a print-friendly version.',
                    ],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                  >
                    <input
                      type="radio"
                      name="doc-logo-mode"
                      className="mt-0.5"
                      disabled={!canEdit}
                      checked={draft.documentLogoMode === value}
                      onChange={() => setDraft((d) => ({ ...d, documentLogoMode: value }))}
                    />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
                {draft.documentLogoMode === 'separate' ? (
                  <LogoSlot
                    kind="logo_document"
                    label="Document logo"
                    hint="Falls back to your primary logo until you upload one."
                    present={!!data.hasDocumentLogo}
                    cacheKey={cacheKey}
                    canEdit={canEdit}
                    fallback={displayName}
                  />
                ) : null}
              </fieldset>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">Accent colour on documents</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Document accent colour picker"
                    disabled={!canEdit}
                    value={
                      isHexColor(draft.documentAccent) ? draft.documentAccent : effectiveDocAccent
                    }
                    onChange={(e) => setDraft((d) => ({ ...d, documentAccent: e.target.value }))}
                    className="h-9 w-11 cursor-pointer rounded border bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    aria-label="Document accent colour"
                    disabled={!canEdit}
                    value={draft.documentAccent}
                    placeholder={effectiveDocAccent}
                    spellCheck={false}
                    onChange={(e) => setDraft((d) => ({ ...d, documentAccent: e.target.value }))}
                    className="h-9 w-32 rounded-md border border-input bg-surface px-2.5 font-mono text-sm"
                  />
                </div>
                <HelperText>
                  Optional. Defaults to your theme’s primary colour, adjusted so it stays readable
                  when printed.
                </HelperText>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Document footer</span>
                <textarea
                  value={draft.footer}
                  disabled={!canEdit}
                  maxLength={500}
                  rows={2}
                  onChange={(e) => setDraft((d) => ({ ...d, footer: e.target.value }))}
                  className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm placeholder:text-subtle"
                  placeholder="Bank details, payment terms, registration lines…"
                />
                <HelperText>
                  Shown at the bottom of every PDF, alongside “Powered by Aivoryx™”.
                </HelperText>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={!canEdit}
                  checked={draft.showCustomerLogo}
                  onChange={(e) => setDraft((d) => ({ ...d, showCustomerLogo: e.target.checked }))}
                />
                <span>
                  <span className="font-medium">Show customer logo on generated documents</span>
                  <span className="block text-xs text-muted-foreground">
                    Off by default. Only customers with a logo uploaded on their record are
                    affected; nothing appears unless you turn this on.
                  </span>
                </span>
              </label>
            </Card>
          </div>

          <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start" aria-label="Live preview">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                Live preview
              </p>
              <div
                role="group"
                aria-label="Preview mode"
                className="flex gap-0.5 rounded-md bg-background-muted p-0.5"
              >
                {(['light', 'dark'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={previewMode === m}
                    onClick={() => setPreviewMode(m)}
                    className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${previewMode === m ? 'bg-surface-raised shadow-sm' : 'text-muted-foreground'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <BrandingPreview
              colors={draft.theme.colors}
              mode={previewMode}
              displayName={displayName}
              logoUrl={logoUrl}
              documentLogoUrl={docLogoUrl ?? logoUrl}
              documentAccentColor={draft.documentAccent || null}
              footer={draft.footer}
              showCustomerLogo={draft.showCustomerLogo}
              loginLogoUrl={loginLogoUrl ?? logoUrl}
              loginWelcome={draft.loginWelcome}
              loginDescription={draft.loginDescription}
              loginShowPoweredBy={draft.loginShowPoweredBy}
            />
            {dirty ? (
              <p className="text-xs text-subtle" role="status">
                You have unsaved changes. The preview shows them; the app does not change until you
                save.
              </p>
            ) : null}
          </aside>
        </div>
      ) : null}

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setDraft((d) => ({ ...d, theme: DEFAULT_THEME }));
          setConfirmReset(false);
        }}
        title="Reset to the Aivoryx default theme?"
        body="This selects the Aivoryx Teal theme in the editor. Nothing changes until you save."
        confirmLabel="Reset"
      />
    </div>
  );
}
