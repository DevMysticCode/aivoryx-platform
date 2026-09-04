import { createHash, randomBytes } from 'node:crypto';

/**
 * One-time invitation tokens (ADR 0030). Same principle as session tokens
 * (ADR 0028): a 256-bit random value handed out once; the database stores only
 * its SHA-256 hash. The plaintext token is never persisted and never returned
 * by an authenticated admin API after creation.
 */

const TOKEN_BYTES = 32;

/** A fresh URL-safe invitation token. Returned once, at creation time only. */
export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The value stored in / looked up from `tenant_invitations.token_hash` (hex SHA-256). */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
