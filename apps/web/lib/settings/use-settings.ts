'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateCompanyProfileRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/settings';
import { adminKeys } from '@/lib/admin/use-admin';
import { useMutationWithFeedback } from '@/lib/api/use-mutation-with-feedback';

/**
 * TanStack Query hooks for platform settings (Phase 10, ADR 0039). Mutations
 * invalidate `/auth/me` too, so the app-shell branding updates immediately
 * after a save — the server stays authoritative.
 */

export const settingsKeys = {
  company: ['settings', 'company'] as const,
  branding: ['settings', 'branding'] as const,
  onboarding: ['settings', 'onboarding'] as const,
};

export function useCompanyProfile() {
  return useQuery({ queryKey: settingsKeys.company, queryFn: api.getCompanyProfile });
}

export function useBranding() {
  return useQuery({ queryKey: settingsKeys.branding, queryFn: api.getBranding });
}

export function useOnboarding() {
  return useQuery({ queryKey: settingsKeys.onboarding, queryFn: api.getOnboarding, retry: false });
}

function useInvalidateBranding() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: settingsKeys.company }),
      qc.invalidateQueries({ queryKey: settingsKeys.branding }),
      qc.invalidateQueries({ queryKey: settingsKeys.onboarding }),
      qc.invalidateQueries({ queryKey: adminKeys.me }),
    ]);
}

export function useUpdateCompanyProfile() {
  const invalidate = useInvalidateBranding();
  return useMutationWithFeedback({
    mutationFn: (patch: UpdateCompanyProfileRequest) => api.updateCompanyProfile(patch),
    onSuccess: invalidate,
    successMessage: 'Company settings saved',
  });
}

export function useUploadLogo() {
  const invalidate = useInvalidateBranding();
  return useMutationWithFeedback({
    mutationFn: ({ kind, file }: { kind: api.LogoKind; file: File }) => api.uploadLogo(kind, file),
    onSuccess: invalidate,
    successMessage: 'Logo uploaded',
  });
}

export function useRemoveLogo() {
  const invalidate = useInvalidateBranding();
  return useMutationWithFeedback({
    mutationFn: (kind: api.LogoKind) => api.removeLogo(kind),
    onSuccess: invalidate,
    successMessage: 'Logo removed',
  });
}

export function useDismissOnboarding() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: api.dismissOnboarding,
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.onboarding }),
  });
}

/** Load the authenticated logo as an object URL, revoking it on change/unmount. */
export function useLogoObjectUrl(enabled: boolean, cacheBust?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    let active = true;
    if (!enabled) {
      setUrl(null);
      return;
    }
    void api.fetchLogoObjectUrl('logo').then((next) => {
      if (!active) {
        if (next) URL.revokeObjectURL(next);
        return;
      }
      revoked = next;
      setUrl(next);
    });
    return () => {
      active = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [enabled, cacheBust]);
  return url;
}
