# ADR 0032 — Inbound Integration Engine & Connector Security

Status: Accepted (Phase 3 — CRM core & lead ingestion)

Implements the pipeline from `docs/architecture/LEAD-INGESTION.md`,
`CONNECTORS-AND-ADAPTERS.md`, `RAW-EVENTS-AND-REPLAY.md`, `PABBLY-BRIDGE.md`,
and `FIELD-MAPPING.md`, and ships the first real connector (Pabbly). Those
documents were "approved architecture, no application code yet" — this ADR
records exactly which parts V1 builds as designed and which parts it
deliberately trims, and why. It is the **inbound** direction (external system
→ Aivoryx); it does not touch or replace the existing transactional
`outbox_events` (Aivoryx → external system, ADR 0013).

## Decision

### 1. Pipeline (as designed)

```
Source (lead_sources) -> Connector (bearer secret) -> Adapter (pabbly_bridge / generic_json)
  -> Mapping (field_mapping dict) -> raw_events + canonical_lead_events
  -> validate -> deduplicate (ADR 0031) -> Lead -> lead.created/lead.updated (outbox)
```

Two transactions, not one: `raw_events` is written and **committed** before
adaptation/mapping/validation ever runs, so the original payload survives even
if everything downstream fails (`RAW-EVENTS-AND-REPLAY.md`). Processing
(adapt → map → validate → dedupe → lead upsert → activity → outbox emit) is a
second, tenant-scoped transaction.

### 2. Connector credential & tenant binding — the security-critical decision

The payload's own `tenant_id` (if any) is **never trusted**. Tenant
resolution:

1. The webhook URL (`POST /api/v1/integrations/webhooks/pabbly/:sourceKey`)
   carries a human-readable `sourceKey` — for routing legibility and log
   correlation only, **not** the security boundary.
2. The `Authorization: Bearer <secret>` header carries the actual connector
   secret. Its SHA-256 hash is bound to a Postgres GUC
   (`app.connector_secret_hash`) via a **by-secret RLS policy** on
   `lead_sources` (`lead_sources_by_secret`) — the exact `tenant_invitations_by_token`
   pattern from ADR 0030, reused rather than reinvented. The policy exposes
   exactly the one source row whose `secret_hash` matches; `lead_sources.secret_hash`
   carries a **global** unique index, so the hash alone is enough to resolve
   one tenant.
3. The source row's own `tenant_id` — read back from that single exposed
   row — is what widens the transaction's RLS context. It is server-derived
   and cannot be influenced by the request.
4. `sourceKey` from the URL is checked against the resolved source's own
   `key` as belt-and-braces (mirrors the explicit `tenant_id` filters used
   throughout ADR 0027); a mismatch is rejected as `CONNECTOR_INVALID` even
   though the secret was individually valid.

A revoked source (`status = 'revoked'`) is rejected with `CONNECTOR_REVOKED`
before any tenant context is ever set. An unknown or malformed secret is
`CONNECTOR_INVALID`. Both are 401 — there is no user session on this route at
all (`@Public()`), so 403 never applies here.

Secret lifecycle mirrors invitation tokens (ADR 0030): a 256-bit
`randomBytes(32)` secret, returned once at creation/rotation, only its
SHA-256 hash persisted. Rotating a secret immediately invalidates the old one
(no grace-period overlap in V1 — the admin UI shows the new secret and the
operator updates the Pabbly workflow before the old one is needed again).

### 3. Idempotency — two independent layers

- **Transport-level (exact redelivery):** a unique index on
  `raw_events(tenant_id, source_id, raw_hash)`. An identical redelivery
  (`raw_hash` = SHA-256 of the canonicalised body) is recognised via
  `INSERT ... ON CONFLICT DO NOTHING`; the existing row is looked up and its
  outcome returned as `DUPLICATE_RAW` — no reprocessing, no second database
  write. Race-safe under concurrent identical deliveries: the DB constraint
  is the source of truth, not an application check.
- **Business-level (same logical event):** a unique index on
  `canonical_lead_events(tenant_id, idempotency_key)`. The key is the
  provider's own record id when supplied (`record:<id>`), otherwise the raw
  event's own id (`raw:<rawEventId>`). **This deliberately does not fold in
  normalised phone/email** the way `RAW-EVENTS-AND-REPLAY.md`'s fallback
  formula does — doing so collapsed two genuinely distinct submissions from
  the same person into one canonical event and prevented the second one from
  ever reaching lead-level dedupe. Business idempotency (the same event) and
  lead deduplication (the same _person_, submitted more than once) are two
  different concerts and now stay decoupled: this key catches literal
  re-delivery of one provider record id or one raw event id; ADR 0031's
  phone/email match is solely responsible for collapsing two different
  submissions into one lead. `INSERT ... ON CONFLICT DO NOTHING` (or, for an
  explicit replay, `ON CONFLICT DO UPDATE` on the same row) makes this
  race-safe too — proven under a genuine concurrent-duplicate-delivery test.

### 4. Failure model & the DLQ simplification

Pipeline status
(`RECEIVED → PROCESSING → {VALIDATION_FAILED, MAPPING_FAILED, DONE, FAILED,
DEAD_LETTER}`, plus `NEEDS_REVIEW` reserved for a future ambiguous-dedupe
path) lives directly on `canonical_lead_events`, with `processing_attempts`,
`last_error_code`, `last_error_message`. **There is no separate
`dead_letter_events` table** as `RAW-EVENTS-AND-REPLAY.md` sketches — its
open/replaying/resolved/discarded lifecycle is redundant with the status +
`integration_event_log` this V1 already has, and the phase brief explicitly
asks for "the minimum durable failure model". `integration_event_log` is the
append-only stage trace (`stage, from_status, to_status, error_code`,
correlation id) used for diagnosis.

A failing event still returns HTTP `200 { accepted: true, status: ... }` to
the connector once its raw body is durably stored — only connector
authentication failures (before any tenant/raw-event write) return 4xx. This
avoids a webhook retry storm against a permanently-invalid payload while
keeping the failure fully diagnosable and replayable from the admin UI.

### 5. Replay

`POST /api/v1/admin/integrations/events/:id/replay` (`crm.integrations.manage`,
tenant-scoped, RLS-enforced) re-runs the pipeline from the stored `raw_events`
row for **any** non-in-flight status, including `DONE`
(`RAW-EVENTS-AND-REPLAY.md`: "available to admin/support for DEAD_LETTER and,
with permission, DONE events"). It reuses the **same** `canonical_lead_events`
row (`ON CONFLICT ... DO UPDATE` on the id it already knows, not a fresh
insert), so replay is itself idempotent and increments `processing_attempts`.
Replay runs in its own transaction, separate from the attempt-count bump, to
avoid a self-deadlock on the row it just updated.

No BullMQ job / retry queue in V1: ingestion is synchronous within the HTTP
request (lightweight DB work only, no outbound calls), and manual replay is
the retry mechanism for anything that needs a fix first. This is a deliberate
simplification — "use existing queue/outbox infrastructure **if
appropriate**" — building BullMQ wiring for a webhook that responds in
milliseconds was not appropriate for V1.

### 6. Mapping — a minimum viable engine, not the full profile/versioning system

`FIELD-MAPPING.md` describes an ordered-rule, versioned `lead_mapping_profiles`
/ `lead_mapping_rules` engine with per-rule transforms. V1 implements its
target vocabulary and "unknown target fails the stage, unmapped fields are
kept" rule, but the mechanism is a flat
`lead_sources.field_mapping` JSON dictionary (`providerKey ->
"canonical:<field>" | "custom:<key>" | "skip"`) merged over a small built-in
default table, evaluated by a pure function
(`apps/api/src/integrations/mapping.ts`). No ordered transforms, no profile
versioning, no replay-pinned-profile-version — there is exactly one real
provider shape in this phase, so the machinery to manage many versions of many
providers' mappings has no current use case yet (CLAUDE.md §17: no
abstraction without one). Adding the richer engine later is additive — the
target vocabulary and failure semantics do not change.

### 7. Adapter — `generic_json`, not a Pabbly-specific parser

No real production Pabbly payload sample exists in this repository
(`docs/integrations/README.md`). Per the phase brief, the `pabbly_bridge`
adapter is the documented `generic_json` fallback: it flattens one level of
the inbound JSON object into a flat provider-field map and extracts a record
id / timestamp from a small set of common key names. It is pure (no DB, no
network) and provider-agnostic — exactly the same code would serve a second
`generic_json` source. No `if (provider === "pabbly")` branching anywhere
outside this one adapter module.

## Consequences

- New tables: `lead_sources`, `raw_events`, `canonical_lead_events`,
  `integration_event_log` — all tenant-owned, RLS `ENABLE`+`FORCE`d;
  `lead_sources` additionally carries the by-secret policy (migration `0005`).
- New permission: `crm.integrations.manage` (source CRUD, event inspection,
  replay).
- New error codes: `SOURCE_NOT_FOUND`, `CONNECTOR_INVALID`,
  `CONNECTOR_REVOKED`, `EVENT_NOT_FOUND`, `EVENT_NOT_REPLAYABLE`.
- When a real Pabbly (or second provider) payload sample is captured, the
  built-in default mapping table and/or a source's `field_mapping` override
  should be reviewed against it — no code change is expected, only
  configuration.
- The full `dead_letter_events` lifecycle table and the versioned mapping
  profile engine remain candidate future work if/when a second real provider
  or a manual-review queue is actually needed.
