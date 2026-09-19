import type {
  PlatformBranding,
  PublicPlatformBranding,
  UpdatePlatformBrandingRequest,
} from '@aivoryx/contracts';
import { API_V1_PREFIX } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch } from './client';

/**
 * Platform branding (Phase 20): the Aivoryx-level identity, managed by Platform
 * Admins only (admin routes) and readable by anyone pre-login (public routes).
 * Entirely separate from tenant branding: different endpoints, tables, storage
 * namespace and permissions.
 */

export type PlatformAssetKind =
  | 'logo_light'
  | 'logo_dark'
  | 'mark'
  | 'favicon'
  | 'login_logo'
  | 'apple_touch'
  | 'pwa_192'
  | 'pwa_512';

export const getPublicPlatformBranding = () =>
  apiFetch<PublicPlatformBranding>('/public/platform/branding', { cache: 'no-store' });

/** A public, cache-busted asset URL - safe as an <img src>; the route is public by design. */
export const platformAssetUrl = (kind: PlatformAssetKind, version: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/public/platform/branding/asset?kind=${kind}&v=${encodeURIComponent(version)}`;

export const getPlatformBranding = () =>
  apiFetch<PlatformBranding>('/platform/branding', { cache: 'no-store' });

export const updatePlatformBranding = (patch: UpdatePlatformBrandingRequest) =>
  apiFetch<PlatformBranding>('/platform/branding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

export async function uploadPlatformAsset(
  kind: PlatformAssetKind,
  file: File,
): Promise<PlatformBranding> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<PlatformBranding>(`/platform/branding/assets?kind=${kind}`, {
    method: 'POST',
    body: form,
  });
}

export const removePlatformAsset = (kind: PlatformAssetKind) =>
  apiFetch<PlatformBranding>(`/platform/branding/assets?kind=${kind}`, { method: 'DELETE' });
