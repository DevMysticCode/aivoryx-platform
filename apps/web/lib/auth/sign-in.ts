import type { MeResponse } from '@aivoryx/contracts';
import { ApiError } from '@/lib/api/client';
import { getMe, login, switchTenant } from '@/lib/api/admin';

/**
 * Why a sign-in attempt did not end in a usable session. Each kind has its own user-facing copy
 * (never a blanket "invalid credentials", never a silent redirect back to /login).
 */
export type SignInFailureKind =
  | 'invalid_credentials'
  | 'session_not_established'
  | 'network'
  | 'no_workspace'
  | 'workspace_unavailable'
  | 'forbidden'
  | 'rate_limited'
  | 'server'
  | 'unexpected';

export class SignInError extends Error {
  constructor(
    readonly kind: SignInFailureKind,
    readonly correlationId?: string,
    readonly code?: string,
  ) {
    super(kind);
    this.name = 'SignInError';
  }
}

export const SIGN_IN_MESSAGES: Record<SignInFailureKind, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  session_not_established:
    "Sign-in succeeded, but we couldn't establish your session. Your browser may be blocking cookies for this site. Allow cookies (or turn off private browsing / cross-site tracking prevention) and try again.",
  network: "We couldn't reach Aivoryx. Check your internet connection and try again.",
  no_workspace:
    "We couldn't determine your workspace. Please use the correct workspace login link, or ask your administrator to check your access.",
  workspace_unavailable:
    'Your workspace or membership is not active. Contact your workspace administrator.',
  forbidden: "You don't have access to sign in here. Contact your workspace administrator.",
  rate_limited: 'Too many sign-in attempts. Please wait a moment and try again.',
  server: 'Something went wrong while signing you in. Please try again.',
  unexpected: 'Something went wrong while signing you in. Please try again.',
};

const WORKSPACE_CODES = new Set(['AUTH_NO_ACTIVE_TENANT']);
const UNAVAILABLE_CODES = new Set([
  'AUTH_MEMBERSHIP_SUSPENDED',
  'AUTH_MEMBERSHIP_INVALID',
  'TENANT_SUSPENDED',
  'TENANT_PROVISIONING',
  'TENANT_ARCHIVED',
]);

/** Classify any thrown value from the sign-in flow. Preserves the backend's stable error code. */
export function classifySignInFailure(err: unknown): SignInError {
  if (err instanceof SignInError) return err;
  if (err instanceof ApiError) {
    const { status, code, correlationId } = err;
    let kind: SignInFailureKind;
    if (code === 'AUTH_INVALID_CREDENTIALS') kind = 'invalid_credentials';
    else if (WORKSPACE_CODES.has(code)) kind = 'no_workspace';
    else if (UNAVAILABLE_CODES.has(code)) kind = 'workspace_unavailable';
    else if (status === 429) kind = 'rate_limited';
    else if (status === 401) kind = 'invalid_credentials';
    else if (status === 403) kind = 'forbidden';
    else if (status >= 500) kind = 'server';
    else kind = 'unexpected';
    return new SignInError(kind, correlationId, code);
  }
  // fetch() rejects with a TypeError when the network / DNS / TLS / CORS layer fails
  if (err instanceof TypeError) return new SignInError('network');
  // res.json() on a malformed success body, or anything else
  return new SignInError('unexpected');
}

export interface SignInResult {
  me: MeResponse;
  hasWorkspace: boolean;
}

/**
 * Sign in and PROVE the session works before the caller navigates.
 *
 *   POST /auth/login          -> 2xx means the credentials were accepted, NOT that the browser kept
 *                                the cookie (a blocked third-party cookie is dropped silently)
 *   GET  /auth/me             -> the only reliable proof the cookie round-trips
 *   POST /auth/switch-tenant  -> when several memberships exist and none was auto-selected
 *
 * A 401 on the verification call is the classic "login loop" (login OK, next page 401, bounce to
 * /login); it is reported as `session_not_established` instead of being swallowed.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  try {
    await login(email, password);
  } catch (err) {
    throw classifySignInFailure(err);
  }

  let me: MeResponse;
  try {
    me = await getMe();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new SignInError('session_not_established', err.correlationId, err.code);
    }
    throw classifySignInFailure(err);
  }

  let hasWorkspace = !!me.active;
  if (!hasWorkspace) {
    const usable = me.memberships.find((m) => m.status === 'active' && m.tenantStatus === 'active');
    if (usable) {
      try {
        me = await switchTenant(usable.id);
        hasWorkspace = !!me.active;
      } catch (err) {
        throw classifySignInFailure(err);
      }
    }
  }

  if (!hasWorkspace && !me.isPlatformAdmin) {
    throw new SignInError(me.memberships.length === 0 ? 'no_workspace' : 'workspace_unavailable');
  }
  return { me, hasWorkspace };
}
