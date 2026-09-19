import { API_V1_PREFIX, type PublicLoginBranding } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch } from './client';

/**
 * Public (pre-authentication) workspace branding for the sign-in page. The
 * tenant is identified only by the slug in the URL; the API returns a minimal,
 * safe field set (or a generic 404), and branding never influences how
 * authentication works.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const isWorkspaceSlug = (v: string | null | undefined): v is string => !!v && SLUG.test(v);

export const getPublicLoginBranding = (slug: string) =>
  apiFetch<PublicLoginBranding>(`/public/workspaces/${encodeURIComponent(slug)}/login-branding`, {
    cache: 'no-store',
  });

/** The public login-logo URL — safe as an <img src> because the route is public by design. */
export const publicLoginLogoUrl = (slug: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/public/workspaces/${encodeURIComponent(slug)}/login-logo`;
