import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../../config/config.module.js';
import type { ResolvedCredential } from '../adapters/connector-adapter.js';

const { connectorCredentials } = schema;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * AES-256-GCM encrypt/decrypt for a recoverable connector credential blob (UC-3, ADR 0051).
 * Standalone, pure functions — directly unit-testable without a DB or the DI container; the
 * service below is a thin wrapper that supplies the key and the persistence.
 */
export function encryptCredentialBlob(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64')).join('.');
}

export function decryptCredentialBlob(key: Buffer, ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed connector credential ciphertext');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Recoverable connector credentials (UC-3, ADR 0051) — AES-256-GCM at rest, decrypted only for the
 * instant a provider API call needs them. Deliberately separate from `lead_sources.secret_hash`
 * (one-way, used to AUTHENTICATE an incoming bearer secret); this is for a secret Aivoryx must
 * PRESENT to a provider (Meta's access token, app secret, subscription verify-token) and so must be
 * able to read back, not merely compare a hash of.
 *
 * Plaintext is never logged and never returned by any API response — the admin controller only
 * ever calls `set()`, never `get()`; `get()`/`getResolvedCredential()` are called exclusively from
 * inside the ingestion path, within an already tenant-scoped transaction.
 */
@Injectable()
export class ConnectorCredentialsService {
  constructor(@Inject(SERVER_ENV) private readonly env: ServerEnv) {}

  /** Encrypt and upsert the one credential blob for `sourceId`. `data` is a flat string map, shaped
   *  per-provider (e.g. `{ appSecret, pageAccessToken, verifyToken }` for Meta). */
  async set(
    tx: Tx,
    input: { tenantId: string; sourceId: string; data: Record<string, string> },
  ): Promise<void> {
    const ciphertext = encryptCredentialBlob(this.key(), JSON.stringify(input.data));
    await tx
      .insert(connectorCredentials)
      .values({ tenantId: input.tenantId, sourceId: input.sourceId, ciphertext })
      .onConflictDoUpdate({
        target: connectorCredentials.sourceId,
        set: { ciphertext, updatedAt: new Date() },
      });
  }

  /** `true` if a credential blob exists for this source — never what it contains. `tenantId` is
   *  filtered explicitly here, in addition to RLS (defense-in-depth, matching `requireSource`'s
   *  existing convention elsewhere in this module) — a caller that passes the wrong tenant for a
   *  real `sourceId` gets `false`, indistinguishable from "no credential configured", never a row
   *  belonging to another tenant. */
  async has(tx: Tx, tenantId: string, sourceId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: connectorCredentials.id })
      .from(connectorCredentials)
      .where(
        and(
          eq(connectorCredentials.sourceId, sourceId),
          eq(connectorCredentials.tenantId, tenantId),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** Decrypted credential data for a source, or `{}` if none is configured OR `tenantId` doesn't
   *  match — the explicit filter is defense-in-depth on top of RLS, not a replacement for it; a
   *  caller must still run inside a transaction whose `app.tenant_id` matches. Callers inside the
   *  ingestion path only — never surfaced through an admin API response. */
  async get(tx: Tx, tenantId: string, sourceId: string): Promise<Record<string, string>> {
    const [row] = await tx
      .select({ ciphertext: connectorCredentials.ciphertext })
      .from(connectorCredentials)
      .where(
        and(
          eq(connectorCredentials.sourceId, sourceId),
          eq(connectorCredentials.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!row) return {};
    return JSON.parse(decryptCredentialBlob(this.key(), row.ciphertext)) as Record<string, string>;
  }

  /** `ResolvedCredential` shape an adapter's `verify()`/`hydrate()` receives. */
  async getResolvedCredential(
    tx: Tx,
    tenantId: string,
    sourceId: string,
  ): Promise<ResolvedCredential> {
    return { data: await this.get(tx, tenantId, sourceId) };
  }

  private key(): Buffer {
    return Buffer.from(this.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY, 'hex');
  }
}
