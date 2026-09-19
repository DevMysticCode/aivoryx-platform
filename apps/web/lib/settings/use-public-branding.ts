'use client';

import { useQuery } from '@tanstack/react-query';
import { getPublicLoginBranding, isWorkspaceSlug } from '@/lib/api/public';

/**
 * Tenant branding for the sign-in page, when the workspace is known from the
 * URL. Any failure (unknown workspace, network) resolves to `null` so the page
 * silently falls back to neutral Aivoryx branding — it never reveals why.
 */
export function usePublicLoginBranding(slug: string | null) {
  const valid = isWorkspaceSlug(slug);
  const q = useQuery({
    queryKey: ['public', 'login-branding', slug],
    queryFn: () => getPublicLoginBranding(slug as string).catch(() => null),
    enabled: valid,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { branding: valid ? (q.data ?? null) : null, isLoading: valid && q.isLoading };
}
