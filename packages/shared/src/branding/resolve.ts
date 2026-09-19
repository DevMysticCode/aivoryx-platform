import { isHexColor } from '../theme/color.js';
import { isThemePresetKey } from '../theme/theme.js';

/**
 * The ONE place that decides which brand shows where (Phase 20). Two layers feed
 * it: PLATFORM branding (Aivoryx itself, managed by platform admins - the
 * default/fallback identity) and TENANT branding (the customer's company, managed
 * by tenant admins). Pages, the shell, the sign-in page, the manifest and the
 * favicon all call this instead of re-implementing precedence.
 *
 * Precedence, per element: tenant value when the tenant configured it, else the
 * platform value, else the hard-coded Aivoryx default. A missing asset is never
 * returned as a URL - `logo()` yields `null` and the UI draws a monogram, so a
 * broken image can't occur. Pure and dependency-free (server + client).
 */

export const DEFAULT_PLATFORM_NAME = 'Aivoryx';

export interface PlatformBrandingLike {
  name?: string | null;
  tagline?: string | null;
  themePreset?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  loginHeading?: string | null;
  loginText?: string | null;
  assets?: Partial<
    Record<
      | 'logoLight'
      | 'logoDark'
      | 'mark'
      | 'favicon'
      | 'loginLogo'
      | 'appleTouch'
      | 'pwa192'
      | 'pwa512',
      boolean
    >
  >;
}

export interface TenantBrandingLike {
  displayName?: string | null;
  themePreset?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  hasLogo?: boolean;
  hasLightLogo?: boolean;
  hasDarkLogo?: boolean;
  hasCompactLogo?: boolean;
  hasFavicon?: boolean;
  hasLoginLogo?: boolean;
  welcomeMessage?: string | null;
  description?: string | null;
  showPoweredBy?: boolean;
}

export type BrandSource = 'tenant' | 'platform';
export type LogoVariant = 'full' | 'compact' | 'login';
export type Surface = 'light' | 'dark';

/** Which stored asset to fetch - the caller maps it to the right endpoint. */
export type AssetRef =
  | {
      source: 'tenant';
      kind: 'logo' | 'logo_light' | 'logo_dark' | 'logo_compact' | 'logo_login' | 'favicon';
    }
  | { source: 'platform'; kind: 'logo_light' | 'logo_dark' | 'mark' | 'login_logo' | 'favicon' };

export interface ThemeInput {
  themePreset: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

const hex = (v: string | null | undefined) => (v && isHexColor(v) ? v : null);
const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** A theme counts as configured when it names a preset or has any valid colour. */
export function hasTheme(t: Partial<ThemeInput> | null | undefined): boolean {
  if (!t) return false;
  return (
    (!!t.themePreset && isThemePresetKey(t.themePreset)) ||
    !!hex(t.primaryColor) ||
    !!hex(t.secondaryColor) ||
    !!hex(t.accentColor)
  );
}

export interface ResolvedBranding {
  name: string;
  tagline: string | null;
  /** the theme to paint, and where it came from; null = the built-in Aivoryx default */
  theme: (ThemeInput & { source: BrandSource }) | null;
  login: { heading: string | null; text: string | null; showPoweredBy: boolean };
  /** true when the tenant supplied any identity of its own */
  tenantBranded: boolean;
  logo: (variant: LogoVariant, surface: Surface) => AssetRef | null;
  favicon: () => AssetRef | null;
}

export function resolveBranding(
  platform: PlatformBrandingLike | null | undefined,
  tenant: TenantBrandingLike | null | undefined,
): ResolvedBranding {
  const pa = platform?.assets ?? {};
  const tenantHasLogo = !!(tenant?.hasLogo || tenant?.hasLightLogo || tenant?.hasDarkLogo);

  const tenantTheme: ThemeInput = {
    themePreset: tenant?.themePreset ?? null,
    primaryColor: tenant?.primaryColor ?? null,
    secondaryColor: tenant?.secondaryColor ?? null,
    accentColor: tenant?.accentColor ?? null,
  };
  const platformTheme: ThemeInput = {
    themePreset: platform?.themePreset ?? null,
    primaryColor: platform?.primaryColor ?? null,
    secondaryColor: platform?.secondaryColor ?? null,
    accentColor: platform?.accentColor ?? null,
  };

  const tenantSurfaceLogo = (surface: Surface): AssetRef | null => {
    if (surface === 'dark' && tenant?.hasDarkLogo) return { source: 'tenant', kind: 'logo_dark' };
    if (surface === 'light' && tenant?.hasLightLogo)
      return { source: 'tenant', kind: 'logo_light' };
    if (tenant?.hasLogo) return { source: 'tenant', kind: 'logo' };
    return null;
  };
  const platformSurfaceLogo = (surface: Surface): AssetRef | null => {
    if (surface === 'dark' && pa.logoDark) return { source: 'platform', kind: 'logo_dark' };
    if (pa.logoLight) return { source: 'platform', kind: 'logo_light' };
    if (pa.logoDark) return { source: 'platform', kind: 'logo_dark' };
    return null;
  };

  return {
    name: text(tenant?.displayName) ?? text(platform?.name) ?? DEFAULT_PLATFORM_NAME,
    tagline: text(platform?.tagline),
    theme: hasTheme(tenantTheme)
      ? { ...tenantTheme, source: 'tenant' }
      : hasTheme(platformTheme)
        ? { ...platformTheme, source: 'platform' }
        : null,
    login: {
      heading: text(tenant?.welcomeMessage) ?? text(platform?.loginHeading),
      text: text(tenant?.description) ?? text(platform?.loginText),
      showPoweredBy: tenant ? (tenant.showPoweredBy ?? true) : true,
    },
    tenantBranded: tenantHasLogo || !!text(tenant?.displayName) || hasTheme(tenantTheme),
    logo(variant, surface) {
      if (variant === 'compact') {
        if (tenant?.hasCompactLogo) return { source: 'tenant', kind: 'logo_compact' };
        // a tenant with its own logo but no square mark gets ITS monogram, not Aivoryx's mark
        if (tenantHasLogo) return null;
        return pa.mark ? { source: 'platform', kind: 'mark' } : null;
      }
      if (variant === 'login') {
        if (tenant?.hasLoginLogo) return { source: 'tenant', kind: 'logo_login' };
        const own = tenantSurfaceLogo(surface);
        if (own) return own;
        if (pa.loginLogo) return { source: 'platform', kind: 'login_logo' };
        return platformSurfaceLogo(surface);
      }
      return tenantSurfaceLogo(surface) ?? platformSurfaceLogo(surface);
    },
    favicon() {
      if (tenant?.hasFavicon) return { source: 'tenant', kind: 'favicon' };
      return pa.favicon ? { source: 'platform', kind: 'favicon' } : null;
    },
  };
}
