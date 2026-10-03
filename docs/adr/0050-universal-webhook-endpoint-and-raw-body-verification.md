# ADR 0050 — Universal webhook endpoint and raw-body verification

Status: accepted (UC-3). Builds on ADR 0032 (Pabbly bridge) and ADR 0049 (native connector lifecycle).

## Context

Every inbound connector before UC-3 used one route, `POST /integrations/webhooks/pabbly/:sourceKey`, and one resolution strategy: look up `lead_sources` by the SHA-256 hash of a presented bearer secret. Meta cannot present a bearer secret at all — its platform has no way to attach a custom `Authorization` header to a webhook delivery — so a second resolution strategy and a provider-neutral route were both required. Meta's signature (`X-Hub-Signature-256`) is also computed over the exact raw request bytes, which the existing body parser discarded after producing the parsed JS object.

## Decisions

1. **New route: `POST /integrations/webhooks/:sourceKey`.** Provider-neutral — the controller never branches on provider; it extracts the same inputs (`sourceKey`, optional bearer header, body, raw bytes, headers) and calls the same `IngestionService.ingest()` as before. The existing `POST /integrations/webhooks/pabbly/:sourceKey` route remains, calling the identical shared handler — a permanent, working alias, not a deprecated shim.
2. **Two source-resolution strategies, selected by what's present in the request, not by provider name.** If an `Authorization: Bearer` header is present, resolve by `secret_hash` (unchanged, ADR 0032). If absent, resolve by a new `lead_sources.public_lookup_key` column — a second, globally-unique column (its own unique constraint, its own RLS policy `lead_sources_by_public_key`, mirroring `lead_sources_by_secret`'s exact pattern) populated only for a signature-style provider (today: Meta). This is a transport-shape decision ("was a secret presented") made once, in `IngestionService.run()`, not a `connector_type` string comparison, and not a decision the controller makes.
3. **A bearer secret is still minted for every source, Pabbly-style or not**, so `lead_sources.secret_hash` stays `NOT NULL` with no schema change to that column, and so a source can be upgraded to use either resolution path later without a migration. A signature-style source's minted secret is simply never presented or checked.
4. **Raw bytes are captured once, at the body-parser boundary, only for the webhook path.** `configure-app.ts`'s existing `bodyParser.json`/`urlencoded` mount (already scoped to `/api/v1/integrations/webhooks`, already carrying `WEBHOOK_MAX_BODY_BYTES`) gained a `verify` callback that stores the exact bytes on `req.rawBody`. Bounded by the same body limit, held only for the lifetime of the request, never persisted to `raw_events` (which already stores the parsed JSON, unchanged) and never logged. `InboundEnvelope.rawBytes` is populated ONLY for the `verify()` call site in `run()` — `parse()`'s call sites (the main path and the replay path) read the already-parsed, already-verified, stored `raw_events.raw_body` and never need the original bytes again.
5. **Meta's one-time subscription handshake (`GET .../:sourceKey/handshake`) is a separate endpoint**, excluded from the public OpenAPI document, that never touches `IngestionService`, persists nothing, and resolves the source by the same `public_lookup_key` before comparing `hub.verify_token` with a constant-time comparison against the connector's configured value (ADR 0051). It shares no code path with the POST pipeline beyond the source lookup.

## Consequences

- The entire UC-0 contract suite (37 assertions) runs unchanged against BOTH routes (`WEBHOOK_ROUTES` in the test harness now lists both), proving the universal route is behaviorally identical to the Pabbly alias for every existing case: authentication, idempotency, dedupe, tenant isolation, response shape.
- No change to `raw_events`, `canonical_lead_events`, or any RLS policy on them.
- A client-side signature check that needs raw bytes for a FUTURE provider has the mechanism already in place; it only needs its own adapter's `verify()`.

## Deferred

A generic (non-Meta) signature-style provider; IP allow-listing; a provider catalog UI.
