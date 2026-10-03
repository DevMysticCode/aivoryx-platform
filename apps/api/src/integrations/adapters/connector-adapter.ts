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
 *  path, IP — the adapter has no legitimate use for them. The connector bearer secret (Pabbly) is
 *  resolved and checked entirely in the existing authentication layer, before an adapter is ever
 *  selected, so it is never part of this envelope either.
 *
 *  `rawBytes` is populated ONLY for the `verify()` call site (UC-3, ADR 0050) — the exact bytes
 *  received over HTTP, before JSON parsing, needed by a provider whose signature (e.g. Meta's
 *  `X-Hub-Signature-256`) is computed over the raw body and would NOT survive a round-trip through
 *  `JSON.parse`/`JSON.stringify` (key order, spacing and number formatting are not guaranteed to
 *  match). It is `undefined` at every other call site (`parse()` from the stored, already-parsed
 *  row) — those never re-verify a signature that has already passed once. */
export interface InboundEnvelope {
  /** the exact raw body as received, already JSON-parsed */
  readonly rawBody: unknown;
  /** exact bytes as received over HTTP — present only where signature verification happens */
  readonly rawBytes?: Buffer;
  /** the small, already-safe-listed header set (`WebhookController.safeHeaders`) — never Authorization */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Credential material an adapter's `verify()`/`hydrate()` may need — a provider-specific, recoverable
 * secret (Meta's app secret, page access token, subscription verify-token), decrypted by
 * `ConnectorCredentialsService` and handed to the adapter for exactly the duration of one request.
 * Deliberately NOT the connector bearer secret used by the existing authentication layer for Pabbly
 * (that is one-way hashed and never recoverable, by design, and is checked before an adapter is ever
 * resolved). Empty for a provider with nothing stored (Pabbly) — its `verify()` ignores this entirely.
 */
export interface ResolvedCredential {
  /** opaque to the core engine; shaped per-provider, read only by the adapter that defined it */
  readonly data: Readonly<Record<string, string>>;
}

/**
 * A thin, provider-neutral pointer to a lead whose field data has NOT been retrieved yet — what a
 * webhook that only carries identifiers (Meta's `leadgen_id`) extracts at `parse()` time. `type` is
 * provider-defined (e.g. `"leadgen_id"`) and exists so a future provider's reference is distinguishable
 * without the ingestion engine ever branching on which provider it came from — it only checks whether
 * `CanonicalDraft.providerReference` is present.
 */
export interface ProviderReference {
  readonly type: string;
  readonly id: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Everything `hydrate()` needs beyond the reference itself. */
export interface HydrationContext {
  readonly credential: ResolvedCredential;
  readonly correlationId: string;
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
  /**
   * Present when this draft is a THIN REFERENCE that still needs `hydrate()` before it carries real
   * field data (UC-3) — e.g. Meta's webhook, which contains only `leadgen_id`. `providerFields` is
   * `{}` and `providerRecordId` already equals `providerReference.id` in that case, so existing
   * idempotency-key derivation (`record:<providerRecordId>`) needs no change whether or not
   * hydration has happened yet. Absent (the common case, Pabbly) means the draft is already final.
   */
  readonly providerReference?: ProviderReference;
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
   *  `IngestionService`. Optional: an adapter with no provider-specific structural rule (Pabbly)
   *  omits it. */
  validate?(draft: CanonicalDraft): ValidationResult;

  /**
   * Turns a `ProviderReference` into a full `CanonicalDraft`, by calling out to the provider's own
   * API (UC-3, ADR 0049). Present only on an adapter whose `parse()` can return a bare reference
   * (Meta); Pabbly has none, because its webhook already carries the full payload.
   *
   * MUST NOT open a database transaction or import anything from `@aivoryx/db` — `IngestionService`
   * calls this strictly BETWEEN its two existing transactions (raw-event persistence, then
   * canonical/CRM processing), never inside either one, so a slow or failing provider API never
   * holds a pooled DB connection open.
   *
   * May reject — with a typed, provider-neutral reason the ingestion layer already knows how to
   * classify (see `HydrationError`) — for an auth failure, a missing/expired lead, a rate limit, a
   * timeout, or a malformed provider response. Never includes the credential or the raw provider
   * response body in the rejection.
   */
  hydrate?(reference: ProviderReference, context: HydrationContext): Promise<CanonicalDraft>;
}

export type HydrationErrorCode =
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_PERMISSION_DENIED'
  | 'PROVIDER_RECORD_NOT_FOUND'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RESPONSE_INVALID';

/** Whether retrying the SAME reference later could plausibly succeed. A 404/permanently-rejected
 *  lead or a bad credential should not be retried; a rate limit, timeout or outage should. The one
 *  place this policy is decided — both `HydrationError.retryable` and the ingestion layer's
 *  provider-redelivery check (`isRetryableHydrationErrorCode`) read it from here. */
const RETRYABLE_HYDRATION_CODES: ReadonlySet<HydrationErrorCode> = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

export function isRetryableHydrationErrorCode(code: string): boolean {
  return RETRYABLE_HYDRATION_CODES.has(code as HydrationErrorCode);
}

/**
 * The provider-neutral failure shape a `hydrate()` implementation throws. `IngestionService` reads
 * only `.retryable` and `.code` — it never knows what "Graph API" or "leadgen_id" mean.
 */
export class HydrationError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: HydrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HydrationError';
    this.retryable = RETRYABLE_HYDRATION_CODES.has(code);
  }
}
