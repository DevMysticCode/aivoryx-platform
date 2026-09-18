import { ApiError } from './client';

/**
 * Human-facing message for an unknown thrown value. The server already sends
 * human-readable `error.message` strings (never a raw machine code) per
 * CLAUDE.md's error-UX contract, so this only needs a safe fallback for the
 * non-`ApiError` case — never surface a technical code like `AUTH_FORBIDDEN`.
 *
 * Deliberately does NOT special-case any error code: some pages test the
 * server's exact wording (e.g. an entitlement-blocked page asserting on
 * phrasing like "not enabled for your workspace"), so this must pass that
 * message through unchanged rather than rewriting it. A page that wants a
 * different message for a specific code (see `ErrorBlock`) does that itself.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
