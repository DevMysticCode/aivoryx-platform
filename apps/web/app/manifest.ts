import type { MetadataRoute } from 'next';
import { getPlatformBrandingServer, platformAssetServerUrl } from '@/lib/branding/server';

/**
 * PWA manifest (ADR 0002). Phase 1 ships an installable shell; a service worker
 * with offline drafts / queued photos / GPS is added with the field workflows
 * in a later phase.
 */
export const revalidate = 300;

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const platform = await getPlatformBrandingServer();
  const name = platform?.name?.trim() || 'Aivoryx';
  const v = platform?.version ?? '0';
  const custom192 = platform?.assets.pwa192;
  const custom512 = platform?.assets.pwa512;
  return {
    name: name === 'Aivoryx' ? 'Aivoryx Platform' : name,
    short_name: name,
    description: platform?.tagline?.trim() || 'Aivoryx Business Operating Platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: platform?.secondaryColor ?? '#231d45',
    icons: [
      {
        src: custom192 ? platformAssetServerUrl('pwa_192', v) : '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: custom512 ? platformAssetServerUrl('pwa_512', v) : '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
