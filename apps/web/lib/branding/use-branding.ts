'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type AssetRef, type ResolvedBranding, resolveBranding } from '@aivoryx/shared';
import type { PublicPlatformBranding } from '@aivoryx/contracts';
import { useMe } from '@/lib/admin/use-admin';
import { useMutationWithFeedback } from '@/lib/api/use-mutation-with-feedback';
import * as api from '@/lib/api/platform-branding';

export const platformBrandingKeys = {
  public: ['public', 'platform-branding'] as const,
  admin: ['platform', 'branding'] as const,
};

/** The Aivoryx-level identity (public read). Failure = null = the built-in default. */
export function usePlatformBranding(): PublicPlatformBranding | null {
  const q = useQuery({
    queryKey: platformBrandingKeys.public,
    queryFn: () => api.getPublicPlatformBranding().catch(() => null),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data ?? null;
}

/**
 * The branding the signed-in UI should show: platform defaults overlaid with the
 * active tenant's own configuration, resolved by the ONE shared resolver. On
 * platform-admin routes with no tenant the tenant layer is absent.
 */
export function useResolvedBranding(opts?: { ignoreTenant?: boolean }): {
  branding: ResolvedBranding;
  platform: PublicPlatformBranding | null;
} {
  const platform = usePlatformBranding();
  const me = useMe();
  const tenant = opts?.ignoreTenant ? null : (me.data?.active?.branding ?? null);
  const branding = useMemo(
    () => resolveBranding(platform ? { ...platform } : null, tenant),
    [platform, tenant],
  );
  return { branding, platform };
}

/** Public URL of a platform asset from a resolved reference (null when it is not one). */
export function platformAssetHref(
  ref: AssetRef | null,
  platform: PublicPlatformBranding | null,
): string | null {
  if (!ref || ref.source !== 'platform') return null;
  return api.platformAssetUrl(ref.kind, platform?.version ?? '0');
}

// ---- admin (platform) ---------------------------------------------------

export function usePlatformBrandingAdmin() {
  return useQuery({ queryKey: platformBrandingKeys.admin, queryFn: api.getPlatformBranding });
}

function useInvalidatePlatformBranding() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: platformBrandingKeys.admin }),
      qc.invalidateQueries({ queryKey: platformBrandingKeys.public }),
    ]);
}

export function useUpdatePlatformBranding() {
  const invalidate = useInvalidatePlatformBranding();
  return useMutationWithFeedback({
    mutationFn: api.updatePlatformBranding,
    onSuccess: invalidate,
    successMessage: 'Platform branding saved',
  });
}

export function useUploadPlatformAsset() {
  const invalidate = useInvalidatePlatformBranding();
  return useMutationWithFeedback({
    mutationFn: ({ kind, file }: { kind: api.PlatformAssetKind; file: File }) =>
      api.uploadPlatformAsset(kind, file),
    onSuccess: invalidate,
    successMessage: 'Image uploaded',
  });
}

export function useRemovePlatformAsset() {
  const invalidate = useInvalidatePlatformBranding();
  return useMutationWithFeedback({
    mutationFn: (kind: api.PlatformAssetKind) => api.removePlatformAsset(kind),
    onSuccess: invalidate,
    successMessage: 'Image removed',
  });
}
