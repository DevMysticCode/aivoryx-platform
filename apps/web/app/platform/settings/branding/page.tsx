'use client';

import { useEffect, useMemo, useState } from 'react';
import type { UpdatePlatformBrandingRequest } from '@aivoryx/contracts';
import { Button } from '@aivoryx/ui';
import {
  type ThemePresetKey,
  deriveTheme,
  isHexColor,
  isThemePresetKey,
  resolveThemeColors,
} from '@aivoryx/shared';
import { Card, ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { HelperText } from '@/components/help/helper-text';
import { InfoPopover } from '@/components/help/info-popover';
import { AssetSlot } from '@/components/branding/asset-slot';
import { BrandingPreview } from '@/components/branding/branding-preview';
import { ThemePicker, type ThemeDraft } from '@/components/branding/theme-picker';
import { useAppearance } from '@/components/theme-provider';
import { platformAssetUrl, type PlatformAssetKind } from '@/lib/api/platform-branding';
import {
  usePlatformBrandingAdmin,
  useRemovePlatformAsset,
  useUpdatePlatformBranding,
  useUploadPlatformAsset,
} from '@/lib/branding/use-branding';

interface Draft {
  name: string;
  tagline: string;
  loginHeading: string;
  loginText: string;
  theme: ThemeDraft;
}

function initialDraft(
  d: {
    platformName?: string | null;
    tagline?: string | null;
    loginHeading?: string | null;
    loginText?: string | null;
    themePreset?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
  } | null,
): Draft {
  const stored = d?.themePreset && isThemePresetKey(d.themePreset) ? d.themePreset : null;
  const preset: ThemePresetKey = stored ?? (d?.primaryColor ? 'custom' : 'aivoryx-teal');
  return {
    name: d?.platformName ?? '',
    tagline: d?.tagline ?? '',
    loginHeading: d?.loginHeading ?? '',
    loginText: d?.loginText ?? '',
    theme: {
      preset,
      colors: resolveThemeColors({
        preset: preset === 'custom' ? null : preset,
        primary: d?.primaryColor,
        secondary: d?.secondaryColor,
        accent: d?.accentColor,
      }),
    },
  };
}

interface SlotDef {
  kind: PlatformAssetKind;
  label: string;
  hint: string;
  flag: keyof PlatformFlags;
}
type PlatformFlags = {
  hasLogoLight: boolean;
  hasLogoDark: boolean;
  hasMark: boolean;
  hasFavicon: boolean;
  hasLoginLogo: boolean;
  hasAppleTouch: boolean;
  hasPwa192: boolean;
  hasPwa512: boolean;
};

const IDENTITY_SLOTS: SlotDef[] = [
  {
    kind: 'logo_light',
    label: 'Logo for light surfaces',
    hint: 'Shown in the sidebar, sign-in and on documents where a workspace has no logo of its own.',
    flag: 'hasLogoLight',
  },
  {
    kind: 'logo_dark',
    label: 'Logo for dark surfaces',
    hint: 'Used in dark mode. Falls back to the light logo.',
    flag: 'hasLogoDark',
  },
  {
    kind: 'mark',
    label: 'App mark / icon',
    hint: 'A square mark for the collapsed sidebar.',
    flag: 'hasMark',
  },
  {
    kind: 'favicon',
    label: 'Favicon',
    hint: 'The browser-tab icon shown for Aivoryx and for workspaces without their own favicon.',
    flag: 'hasFavicon',
  },
];
const LOGIN_SLOTS: SlotDef[] = [
  {
    kind: 'login_logo',
    label: 'Sign-in logo',
    hint: 'Optional. Shown on the shared sign-in page instead of the main logo.',
    flag: 'hasLoginLogo',
  },
];
const APP_SLOTS: SlotDef[] = [
  {
    kind: 'apple_touch',
    label: 'Apple touch icon',
    hint: 'Home-screen icon on iOS. Square, at least 180 × 180 px.',
    flag: 'hasAppleTouch',
  },
  {
    kind: 'pwa_192',
    label: 'App icon 192',
    hint: 'Installed-app icon. Exactly square, at least 192 × 192 px.',
    flag: 'hasPwa192',
  },
  {
    kind: 'pwa_512',
    label: 'App icon 512',
    hint: 'Installed-app icon. Exactly square, at least 512 × 512 px.',
    flag: 'hasPwa512',
  },
];

/**
 * Platform branding (Phase 20): the Aivoryx-level identity, editable only by
 * Platform Admins (the API enforces it; this route is also gated by the platform
 * layout). It is the default and fallback for every workspace - a tenant's own
 * branding overrides it only where the tenant configured something.
 */
export default function PlatformBrandingPage() {
  const admin = usePlatformBrandingAdmin();
  const save = useUpdatePlatformBranding();
  const upload = useUploadPlatformAsset();
  const remove = useRemovePlatformAsset();
  const appearance = useAppearance();
  const data = admin.data;

  const [draft, setDraft] = useState<Draft>(() => initialDraft(null));
  const [baseline, setBaseline] = useState<Draft>(() => initialDraft(null));
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>(appearance.resolved);

  useEffect(() => {
    if (!data) return;
    const next = initialDraft(data);
    setDraft(next);
    setBaseline(next);
  }, [data]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const allHex = (['primary', 'secondary', 'accent'] as const).every((k) =>
    isHexColor(draft.theme.colors[k]),
  );
  const contrast = useMemo(() => deriveTheme(draft.theme.colors).report, [draft.theme.colors]);
  const valid = allHex && contrast.ok;

  const patch = useMemo<UpdatePlatformBrandingRequest>(() => {
    const body: Record<string, unknown> = {
      platformName: draft.name.trim(),
      tagline: draft.tagline.trim(),
      loginHeading: draft.loginHeading.trim(),
      loginText: draft.loginText.trim(),
      themePreset: draft.theme.preset,
    };
    if (draft.theme.preset === 'custom') {
      body.primaryColor = draft.theme.colors.primary.toLowerCase();
      body.secondaryColor = draft.theme.colors.secondary.toLowerCase();
      body.accentColor = draft.theme.colors.accent.toLowerCase();
    }
    return body as UpdatePlatformBrandingRequest;
  }, [draft]);

  const displayName = draft.name.trim() || 'Aivoryx';
  const version = data?.version ?? '0';
  const urlFor = (kind: PlatformAssetKind, present: boolean) =>
    present ? platformAssetUrl(kind, version) : null;

  const renderSlots = (slots: SlotDef[]) => (
    <div className="grid gap-3 md:grid-cols-2">
      {slots.map((s) => {
        const present = !!data?.[s.flag];
        return (
          <AssetSlot
            key={s.kind}
            label={s.label}
            hint={s.hint}
            present={present}
            previewUrl={urlFor(s.kind, present)}
            canEdit
            fallback={displayName}
            onUpload={(file) => upload.mutate({ kind: s.kind, file })}
            onRemove={() => remove.mutateAsync(s.kind)}
            uploading={upload.isPending && upload.variables?.kind === s.kind}
            removing={remove.isPending && remove.variables === s.kind}
            error={
              (upload.isError && upload.variables?.kind === s.kind ? upload.error : null) ??
              (remove.isError && remove.variables === s.kind ? remove.error : null)
            }
          />
        );
      })}
    </div>
  );

  const previewLogo = urlFor('logo_light', !!data?.hasLogoLight);
  const previewLoginLogo = urlFor('login_logo', !!data?.hasLoginLogo) ?? previewLogo;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform branding"
        description="The Aivoryx identity - the default for every workspace. A workspace's own branding overrides it only where the workspace has configured something."
      >
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
      </PageHeader>

      {admin.isLoading ? <Skeleton rows={6} /> : null}
      {admin.error ? <ErrorNote error={admin.error} /> : null}
      {save.error ? <ErrorNote error={save.error} /> : null}

      {data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Identity</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Platform name</span>
                  <input
                    value={draft.name}
                    maxLength={80}
                    placeholder="Aivoryx"
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm placeholder:text-subtle"
                  />
                  <HelperText>Shown in the browser tab and installed-app name.</HelperText>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Tagline</span>
                  <input
                    value={draft.tagline}
                    maxLength={160}
                    placeholder="Business Operating Platform"
                    onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm placeholder:text-subtle"
                  />
                  <HelperText>Used as the site description.</HelperText>
                </label>
              </div>
              {renderSlots(IDENTITY_SLOTS)}
            </Card>

            <Card className="space-y-4">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold">Theme</h2>
                <InfoPopover label="About the platform theme">
                  <p>
                    The default colours for the whole product. A workspace that picks its own theme
                    overrides them. Status colours never change.
                  </p>
                </InfoPopover>
              </div>
              <ThemePicker
                value={draft.theme}
                onChange={(theme) => setDraft((d) => ({ ...d, theme }))}
              />
            </Card>

            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Sign-in</h2>
              <p className="-mt-2 text-xs text-muted-foreground">
                Shown on the shared sign-in page, and on a workspace&apos;s sign-in page wherever
                the workspace has not set its own.
              </p>
              {renderSlots(LOGIN_SLOTS)}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Sign-in heading</span>
                <input
                  value={draft.loginHeading}
                  maxLength={80}
                  placeholder="Sign in"
                  onChange={(e) => setDraft((d) => ({ ...d, loginHeading: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm placeholder:text-subtle"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Supporting text</span>
                <textarea
                  value={draft.loginText}
                  maxLength={240}
                  rows={2}
                  placeholder="Access your workspace."
                  onChange={(e) => setDraft((d) => ({ ...d, loginText: e.target.value }))}
                  className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm placeholder:text-subtle"
                />
                <HelperText>Plain text only. Leave blank to use the default wording.</HelperText>
              </label>
            </Card>

            <Card className="space-y-4">
              <h2 className="text-sm font-semibold">Browser &amp; app identity</h2>
              <p className="-mt-2 text-xs text-muted-foreground">
                Icons for installed-app (PWA) and home-screen use. When unset, the built-in Aivoryx
                icons are used.
              </p>
              {renderSlots(APP_SLOTS)}
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
              show={['app', 'login']}
              colors={draft.theme.colors}
              mode={previewMode}
              displayName={displayName}
              logoUrl={previewLogo}
              documentLogoUrl={null}
              documentAccentColor={null}
              footer=""
              showCustomerLogo={false}
              loginLogoUrl={previewLoginLogo}
              loginWelcome={draft.loginHeading}
              loginDescription={draft.loginText}
              loginShowPoweredBy={false}
            />
            {dirty ? (
              <p className="text-xs text-subtle" role="status">
                You have unsaved changes. The preview shows them; nothing changes until you save.
              </p>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
