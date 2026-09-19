import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/app-shell';
import { buildThemeCss, hasTheme, resolveThemeColors } from '@aivoryx/shared';
import { THEME_INIT_SCRIPT } from '@/lib/theme/appearance';
import { getPlatformBrandingServer, platformAssetServerUrl } from '@/lib/branding/server';

/**
 * Metadata follows the PLATFORM branding (Phase 20): title, favicon, touch icon.
 * Tenant-specific favicons are applied client-side by `BrandProvider` (a tenant is
 * only known after sign-in, and the session cookie is not readable here), so this
 * is the platform default that every page and every logged-out visitor sees.
 */
/** the platform branding can change; pages re-render at most every 5 minutes */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const platform = await getPlatformBrandingServer();
  const name = platform?.name?.trim() || 'Aivoryx';
  const v = platform?.version ?? '0';
  const icons: Metadata['icons'] = {};
  if (platform?.assets.favicon) icons.icon = [{ url: platformAssetServerUrl('favicon', v) }];
  if (platform?.assets.appleTouch)
    icons.apple = [{ url: platformAssetServerUrl('apple_touch', v) }];
  return {
    title: {
      default: name === 'Aivoryx' ? 'Aivoryx Platform' : name,
      template: `%s · ${name}`,
    },
    description: platform?.tagline?.trim() || 'Aivoryx Business Operating Platform',
    applicationName: name,
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
    ...(Object.keys(icons).length ? { icons } : {}),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9fafb' },
    { media: '(prefers-color-scheme: dark)', color: '#100e1b' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const platform = await getPlatformBrandingServer();
  const platformThemeCss =
    platform && hasTheme(platform)
      ? buildThemeCss(
          resolveThemeColors({
            preset: platform.themePreset === 'custom' ? null : platform.themePreset,
            primary: platform.primaryColor,
            secondary: platform.secondaryColor,
            accent: platform.accentColor,
          }),
        )
      : null;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* platform default theme, in the first paint (no flash); a tenant theme layers on top */}
        {platformThemeCss ? (
          <style
            id="aivoryx-platform-theme"
            dangerouslySetInnerHTML={{ __html: platformThemeCss }}
          />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
