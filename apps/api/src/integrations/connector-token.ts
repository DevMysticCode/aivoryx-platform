import { createHash, randomBytes } from 'node:crypto';

/**
 * Inbound connector credentials (ADR 0032). Same principle as session tokens
 * (ADR 0028) and invitation tokens (ADR 0030): a 256-bit random value handed
 * out once; the database stores only its SHA-256 hash. The plaintext secret is
 * never persisted and never returned by an authenticated admin API after
 * creation/rotation.
 */

const SECRET_BYTES = 32;

/** A fresh URL-safe connector secret. Returned once, at creation/rotation time only. */
export function generateConnectorSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/** The value stored in / looked up from `lead_sources.secret_hash` (hex SHA-256). */
export function hashConnectorSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Parse an `Authorization: Bearer <secret>` header. Returns `null` if malformed/missing. */
export function extractBearerSecret(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match ? match[1]! : null;
}
