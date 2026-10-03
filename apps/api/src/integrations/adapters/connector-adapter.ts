/**
 * Universal Connector UC-2 — the provider-neutral adapter contract.
 *
 * These types deliberately import NOTHING from the rest of the repository. No CRM, no Drizzle, no
 * `@aivoryx/db`, no tenant/business services, no Nest controllers. An adapter sees a payload and
 * headers; it has no way to reach the database, a tenant, or a lead, even by accident.
 *
 * The full provider lifecycle (verify -> parse -> optional validate) is represented even though
 * Pabbly, the only adapter in UC-2, needs just `parse`. `verify` and `validate` exist so a future
 * provider that genuinely needs transport-level verification (an HMAC signature, a challenge
 * response) or provider-specific structural checks has a place to put them without a second
 * interface change — not because Pabbly uses them today.
 */

/** The minimum of an inbound delivery an adapter needs. Never the raw Express request: no method,
 *  path, IP or `Authorization` header — the adapter has no legitimate use for any of them. The
 *  connector secret is resolved and checked entirely in the existing authentication layer, before an
 *  adapter is ever selected; `verify()` below is about provider-specific transport verification
 *  (e.g. a provider's own signature header), which is a different thing and which Pabbly does not
 *  have. */
export interface InboundEnvelope {
  /** the exact raw body as received, already JSON-parsed */
  readonly rawBody: unknown;
  /** the small, already-safe-listed header set (`WebhookController.safeHeaders`) — never Authorization */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Credential material an adapter's `verify()` may need to check a provider-specific signature.
 * Deliberately NOT the connector secret used by the existing bearer-auth layer (that check already
 * happened before an adapter is resolved) — this is for a provider that signs its payload with its
 * OWN key, separate from the Aivoryx connector credential. Pabbly has no such key, so its `verify()`
 * ignores this and returns success.
 */
export interface ResolvedCredential {
  /** opaque to the core engine; only an adapter that defined this shape of secret reads it */
  readonly providerSecret?: string;
}

export interface VerificationResult {
  readonly verified: boolean;
  /** stable error code when `verified` is false (never a human-readable leak of *why*, by itself) */
  readonly reason?: string;
}

/** Provider-neutral output of parsing. The adapter's whole job ends here — mapping the flat
 *  `providerFields` into canonical/custom fields is the EXISTING `mapProviderFields` engine, which
 *  UC-2 does not move. This is a draft, not a canonical event: no idempotency key, no tenant id, no
 *  identity validation. Those happen afterward, exactly where they happen today. */
/** A single provider field's raw (unmapped) value — the same scalar set `mapProviderFields`
 *  (the existing, unmoved mapping engine) has always accepted. */
export type ProviderFieldValue = string | number | boolean | null;

export interface CanonicalDraft {
  readonly providerFields: Record<string, ProviderFieldValue>;
  readonly providerRecordId: string | null;
  readonly providerTimestamp: string | null;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Catalog-ready, but UC-2 builds no catalog — this is just a field on the adapter object. */
export type ProviderCapability = 'inbound_webhook' | 'field_mapping';

export interface ProviderMeta {
  readonly provider: string;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: readonly ProviderCapability[];
}

/**
 * One version of one provider's adapter. `provider` + `version` is the registry key (ADR 0049):
 * `lead_sources.connector_type` resolves `provider`; no column exists yet for `version`, so every
 * caller resolves version 1 today (`AdapterRegistry.resolve` defaults to it) — see the registry for
 * exactly how an unversioned row keeps working.
 */
export interface ConnectorAdapter {
  readonly provider: string;
  readonly version: number;
  readonly meta: ProviderMeta;

  /** Provider-specific transport verification (e.g. a provider's own payload signature) — NOT the
   *  connector bearer secret, which the existing authentication layer already checked. An adapter
   *  with nothing to verify (Pabbly) returns `{ verified: true }` unconditionally. */
  verify(envelope: InboundEnvelope, credential: ResolvedCredential): VerificationResult;

  /** Pure: no DB, no network, no clock. Never throws on malformed input — returns empty/null fields,
   *  exactly like the pre-UC-2 Pabbly parser did. */
  parse(envelope: InboundEnvelope): CanonicalDraft;

  /** Provider-specific structural checks only (e.g. "this provider always sends a record id") —
   *  NEVER generic lead validation (identity presence, custom-field coercion), which stays in
   *  `IngestionService` until UC-3's canonical ingestion engine exists to own it generically.
   *  Optional: an adapter with no provider-specific structural rule (Pabbly) omits it. */
  validate?(draft: CanonicalDraft): ValidationResult;
}
