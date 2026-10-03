# ADR 0049 — Native connector lifecycle and provider hydration

Status: accepted (UC-3). Builds on UC-2's `ConnectorAdapter`/`AdapterRegistry` and the UC-3 architecture spike that established the `hydrate()` extension and its rationale in detail.

## Context

UC-2's adapter contract (`verify` / `parse` / optional `validate`) was proven against Pabbly, whose webhook already carries the complete lead payload. Meta Lead Ads does not: its webhook carries only a `leadgen_id`; the actual field data requires a second, authenticated call to the Meta Graph API, made AFTER the webhook is received. The spike concluded the existing contract could not represent this without leaking transaction/async concerns into `IngestionService`.

## Decisions

1. **`CanonicalDraft` gains an optional `providerReference`** (`{ type, id, metadata? }`) rather than `parse()`'s return type becoming a union. `providerFields` stays `{}` and `providerRecordId` already equals the reference's `id` when a draft is reference-only — so existing idempotency-key derivation (`record:<id>`) needs no change whether or not hydration has happened. `PabblyAdapter` needs zero changes: it never sets `providerReference`.
2. **`ConnectorAdapter` gains optional `hydrate(reference, context): Promise<CanonicalDraft>`.** `HydrationContext` is `{ credential, correlationId }`. Present only on an adapter whose `parse()` can return a bare reference.
3. **Hydration runs strictly between `IngestionService`'s two existing transactions, never inside either.** `resolveDraft()` is a new private method: it reads the stored raw row (short transaction, commits immediately), calls `parse()` (pure/sync), and — only if a `providerReference` came back — reads the connector's credential (a second short transaction) and calls `hydrate()` with NO transaction open. `processRawEvent` calls `resolveDraft()` before `processRawEventTx` (which now takes the resolved `draft` as a parameter instead of parsing internally). This preserves the two-transaction architecture exactly; it adds a step between them, it does not touch either transaction's boundary.
4. **`verify()` is now actually called.** UC-2 defined it but `IngestionService` never invoked it. UC-3 wires it into `run()`, generically, for every adapter, immediately before the raw event is inserted — Pabbly's no-op `{verified:true}` makes this a no-op for Pabbly; Meta's HMAC check makes it a real gate for Meta. No `if (provider === ...)` branch: the call site is the same for every adapter, resolved through the registry exactly as `parse()` already was.
5. **Hydration failures get their own error codes, not a generic one.** `HydrationError` (`code`, derived `retryable`) carries one of: `PROVIDER_AUTH_FAILED`, `PROVIDER_PERMISSION_DENIED`, `PROVIDER_RECORD_NOT_FOUND`, `PROVIDER_RATE_LIMITED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_RESPONSE_INVALID`. `recordProcessingFailure` (the existing UC-1 failure-recording path) stores `err.code` as `canonical_lead_events.last_error_code` when the error is a `HydrationError`, instead of the generic `PROCESSING_ERROR`. The existing provider-redelivery-retry check (a `DUPLICATE_RAW` whose prior attempt failed) is generalized from "`lastErrorCode === PROCESSING_ERROR`" to "`PROCESSING_ERROR` OR a retryable hydration code" — a rate limit or timeout is retried on the provider's own redelivery; a 404/permission/auth failure is not (`retryable: false`), matching that retrying those cannot succeed.
6. **`ResolvedCredential` widens from `{ providerSecret? }` to `{ data: Record<string,string> }`** — opaque to the engine, shaped per-adapter. See ADR 0051 for where it comes from.

## Consequences

- `PabblyAdapter` is unchanged; its behavior is proven unchanged by the full UC-0/UC-1 suites passing unmodified.
- `IngestionService` gained one new private method (`resolveDraft`) and one new call site (`verify()` in `run()`); its two-transaction structure, idempotency, dedupe, enrichment, activities and outbox logic are byte-for-byte what they were.
- A future provider needing the same two-step shape (reference → hydrate) reuses this exact mechanism; a provider that never needs it (any future bearer-style, complete-payload webhook) ignores `hydrate()` entirely, exactly as Pabbly does.

## Deferred

Persisted `adapter_version` (still runtime-default `1` — see UC-2); outbound deliveries; a workflow/automation layer; any second native provider.
