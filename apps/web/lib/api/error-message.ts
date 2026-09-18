import { ApiError } from './client';

/**
 * Human-facing message for an unknown thrown value. The server already sends
 * human-readable `error.message` strings (never a raw machine code) per
 * CLAUDE.md's error-UX contract, so this only needs a safe fallback for the
 * non-`ApiError` case — never surface a technical code like `AUTH_FORBIDDEN`.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
