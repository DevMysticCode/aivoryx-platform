import type {
  Branding,
  CompanyProfile,
  Onboarding,
  UpdateCompanyProfileRequest,
} from '@aivoryx/contracts';
import { API_V1_PREFIX } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch } from './client';

/**
 * Platform-settings API calls (Phase 10, ADR 0039) — company profile, branding,
 * logo and onboarding. Thin typed wrappers over `apiFetch`; the server enforces
 * `settings.company.*` for every mutation. Consuming branding needs no permission.
 */

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export type LogoKind = 'logo' | 'logo_light' | 'logo_dark' | 'favicon';

export const getCompanyProfile = () =>
  apiFetch<CompanyProfile>('/settings/company', { cache: 'no-store' });

export const updateCompanyProfile = (patch: UpdateCompanyProfileRequest) =>
  apiFetch<CompanyProfile>('/settings/company', { ...json(patch), method: 'PUT' });

export const getBranding = () => apiFetch<Branding>('/settings/branding', { cache: 'no-store' });

export const getOnboarding = () => apiFetch<Onboarding>('/onboarding', { cache: 'no-store' });

export const dismissOnboarding = () =>
  apiFetch<Onboarding>('/onboarding/dismiss', { method: 'POST' });

export async function uploadLogo(kind: LogoKind, file: File): Promise<CompanyProfile> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<CompanyProfile>(`/settings/company/logo?kind=${kind}`, {
    method: 'POST',
    body: form,
  });
}

export const removeLogo = (kind: LogoKind) =>
  apiFetch<CompanyProfile>(`/settings/company/logo?kind=${kind}`, { method: 'DELETE' });

/**
 * Fetch the authenticated logo stream as an object URL. Uses `fetch` with
 * credentials so it works cross-site (a `<img src>` would drop the SameSite
 * session cookie in production). Returns `null` when there is no logo.
 */
export async function fetchLogoObjectUrl(kind: LogoKind = 'logo'): Promise<string | null> {
  const url = `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/settings/company/logo?kind=${kind}`;
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
