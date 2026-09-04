import type { MetadataRoute } from 'next';

/**
 * PWA manifest (ADR 0002). Phase 1 ships an installable shell; a service worker
 * with offline drafts / queued photos / GPS is added with the field workflows
 * in a later phase.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aivoryx Platform',
    short_name: 'Aivoryx',
    description: 'Aivoryx Business Operating Platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0b1220',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
