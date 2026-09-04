import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque session tokens (ADR 0028).
 *
 * The cookie carries a 256-bit random token. The database stores only its
 * SHA-256 hash (`sessions.token_hash`), so a database leak yields no usable
 * sessions — the same principle as passwords. SHA-256 (not Argon2) is right
 * here: the token has full entropy, so there is nothing to brute-force and the
 * per-request lookup must stay cheap.
 */

const TOKEN_BYTES = 32;

/** A fresh URL-safe session token. Exists only in memory and the Set-Cookie header. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The value stored in / looked up from `sessions.token_hash` (hex SHA-256). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex token hashes. */
export function tokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
