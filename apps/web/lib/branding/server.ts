import { API_V1_PREFIX, type PublicPlatformBranding } from '@aivoryx/contracts';
import { webEnv } from '@/lib/env';

/**
 * Server-side read of the PLATFORM branding, for things that must be right in the
 * initial HTML: the theme <style>, the document title, the favicon / touch icons
 * and the PWA manifest. Cached for 5 minutes (Next data cache) and fail-soft:
 * any error or slow API resolves to `null`, i.e. the built-in Aivoryx defaults,
 * so a branding outage can never take the site down.
 */
export async function getPlatformBrandingServer(): Promise<PublicPlatformBranding | null> {
  try {
    const res = await fetch(
      `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/public/platform/branding`,
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(2500) },
    );
    if (!res.ok) return null;
    return (await res.json()) as PublicPlatformBranding;
  } catch {
    return null;
  }
}

/** Public asset URL usable from server-rendered metadata. */
export function platformAssetServerUrl(kind: string, version: string): string {
  return `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/public/platform/branding/asset?kind=${kind}&v=${encodeURIComponent(version)}`;
}
