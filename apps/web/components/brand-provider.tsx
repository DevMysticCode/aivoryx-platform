'use client';

import { useEffect } from 'react';
import { buildThemeCss, isThemePresetKey, resolveThemeColors } from '@aivoryx/shared';
import { useMe } from '@/lib/admin/use-admin';
import { useResolvedBranding } from '@/lib/branding/use-branding';
import { useLogoObjectUrl } from '@/lib/settings/use-settings';
import { BRAND_CACHE_STORAGE_KEY } from '@/lib/theme/appearance';

/** The subset of the branding payload that drives the theme. */
export interface ThemeInput {
  themePreset?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
}

/**
 * The CSS a workspace's branding produces, or null when the tenant has not
 * configured anything (the platform default theme then applies untouched).
 * A named preset wins; otherwise the stored hex colours are a "custom" theme.
 * Pure — the same function paints the live preview in Settings.
 */
export function themeCssFor(input: ThemeInput): string | null {
  const preset =
    input.themePreset && isThemePresetKey(input.themePreset) ? input.themePreset : null;
  const hasCustom = !!(input.primaryColor || input.secondaryColor || input.accentColor);
  if (!preset && !hasCustom) return null;
  return buildThemeCss(
    resolveThemeColors({
      preset: preset === 'custom' ? null : preset,
      primary: input.primaryColor,
      secondary: input.secondaryColor,
      accent: input.accentColor,
    }),
  );
}

/**
 * Applies the tenant's brand to the app by overriding brand design tokens
 * (`--primary*`, `--ring/--focus`, `--brand-secondary/accent`, `--chart-1..3`) for
 * BOTH light and dark mode (Phase 10 ADR 0039, extended in Phase 19 ADR 0046).
 *
 * This is a TOKEN override, never arbitrary CSS: the only thing that can reach
 * the page is HSL triples derived by the shared theme engine from server-
 * validated `#rrggbb` values, and the engine never emits status colours
 * (success / warning / danger / info stay platform-owned). The derived CSS is
 * also cached in localStorage so the next page load paints the brand before
 * `/auth/me` returns (no flash of the default teal).
 */
export function BrandProvider({
  disabled,
  platformOnly,
}: {
  disabled?: boolean;
  /** platform-admin routes: paint the platform theme only (no tenant layer, no cache) */
  platformOnly?: boolean;
}) {
  // pre-auth routes: never read the session and never show a cached tenant brand
  return disabled ? <NoBrand /> : <ActiveBrand platformOnly={platformOnly} />;
}

function NoBrand() {
  useEffect(() => {
    document.getElementById('aivoryx-brand-cache')?.remove();
  }, []);
  return null;
}

function ActiveBrand({ platformOnly }: { platformOnly?: boolean }) {
  const me = useMe();
  const { branding } = useResolvedBranding({ ignoreTenant: platformOnly });
  // ONE resolved theme: the tenant's when it configured one, else the platform's
  const css = branding.theme ? themeCssFor(branding.theme) : null;

  useEffect(() => {
    if (platformOnly) {
      document.getElementById('aivoryx-brand-cache')?.remove();
      return;
    }
    if (!me.data) return;
    try {
      if (css) localStorage.setItem(BRAND_CACHE_STORAGE_KEY, css);
      else localStorage.removeItem(BRAND_CACHE_STORAGE_KEY);
    } catch {
      /* storage blocked — brand still applies for this session */
    }
    // the derived <style> below now owns the tokens
    document.getElementById('aivoryx-brand-cache')?.remove();
  }, [css, me.data, platformOnly]);

  // Tenant favicon (platform favicon is server-rendered metadata). Managed here,
  // once, rather than per page.
  const fav = platformOnly ? null : branding.favicon();
  const faviconUrl = useLogoObjectUrl(fav?.source === 'tenant', branding.name, 'favicon');
  useEffect(() => {
    if (!faviconUrl) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = faviconUrl;
    link.dataset.aivoryxFavicon = '';
    document.head.appendChild(link);
    return () => link.remove();
  }, [faviconUrl]);

  if (!css) return null;
  return <style data-aivoryx-brand="">{css}</style>;
}
