# Raw Event, Idempotency, Retry, Replay and Dead-Letter Architecture

Status: **Implemented in Phase 3** (ADR 0032), with two deliberate V1
trims documented there: `DEAD_LETTER` is a `canonical_lead_events.status`
value rather than a separate `dead_letter_events` table with its own
open/replaying/resolved/discarded lifecycle, and the idempotency-key fallback
(no `provider_record_id`) keys off the raw event's own id rather than a
phone/email/timestamp hash — the latter was found, via testing, to
incorrectly collapse two distinct submissions from the same person into one
event, which is lead-level deduplication's job (ADR 0031), not idempotency's.
No BullMQ retry queue in V1 — ingestion is synchronous; manual replay is the
retry mechanism.

Covers decision 23: raw external payloads/events are persisted for debugging,
reconciliation, replay and idempotency.

## Records

### raw_events

The untouched inbound payload. Written **before** any parsing, in its own
transaction, so nothing downstream can lose the original.

```
id                uuid v7 (pk)
tenant_id         uuid  (RLS)
source_id         uuid  (fk)
connector_type    enum
correlation_id    text            // AIV-<ULID>, one per inbound event
received_at       timestamptz
transport_metadata jsonb          // headers, sender, request id, mailbox id
raw_body_ref      text            // object-storage key (R2) for large bodies
raw_body_inline   bytea null      // small bodies stored inline
raw_hash          text            // sha-256 of raw_body, for exact-dup detection
attachment_refs   jsonb           // object-storage keys
ingest_status     enum            // see state model
idempotency_key   text null       // set once known (may be after adapter)
created_at
```

Retention: configurable per tenant (default 180 days), then body moved to cold
storage / purged while a metadata stub is kept for reconciliation counts.

### canonical_lead_events

Output of adapter + mapping; the working record for validation/dedup/lead.

```
id                uuid v7 (pk)
tenant_id         uuid  (RLS)
raw_event_id      uuid  (fk, unique per successful processing attempt)
mapping_profile_version int
canonical         jsonb           // standard CRM field map
custom            jsonb           // { field_key: typed_value }
unmapped          jsonb           // provider fields with no rule
idempotency_key   text            // NOT NULL here
status            enum            // see state model
lead_id           uuid null       // set after Lead stage
dedupe_outcome    enum null
processing_attempts int
last_error_code   text null
created_at / updated_at
```

### integration_event_log

Append-only stage transitions for one inbound event (observability + support).

```
id, tenant_id, correlation_id, raw_event_id, canonical_lead_event_id null,
stage, from_status, to_status, error_code null, message null,
duration_ms, actor (system|user id), created_at
```

### dead_letter_events

Pointer + reason for events parked for human action.

```
id, tenant_id, raw_event_id, canonical_lead_event_id null,
failed_stage, error_code, reason, payload_snapshot_ref,
status enum: open | replaying | resolved | discarded,
assigned_to null, resolved_by null, resolved_at null,
created_at / updated_at
```

## State model

```
RECEIVED
  -> STORED                 (raw_events written)
  -> ADAPTING               -> ADAPTER_FAILED  -> DEAD_LETTER
  -> MAPPING                 -> MAPPING_FAILED  -> DEAD_LETTER
  -> VALIDATING              -> INVALID         -> DEAD_LETTER
  -> DEDUPING                -> NEEDS_REVIEW    (manual queue, not DLQ)
  -> LEAD_UPSERT             -> LEAD_UPSERT_RETRY (transient) -> ... -> DEAD_LETTER (exhausted)
  -> EMITTED                 (LeadCreated/LeadUpdated on the outbox)
  -> DONE
```

Terminal: `DONE`, `DEAD_LETTER` (until replayed), `DISCARDED`.
No state ever silently drops an event.

## Idempotency

- **Transport exact-duplicate:** identical `raw_hash` for the same `source_id`
  within a window -> new `raw_events` row is still stored (audit) but flagged
  `duplicate_raw` and not processed.
- **Business idempotency key:** `provider_record_id` when present; otherwise
  `sha256(source_id + normalised_phone + normalised_email + provider_timestamp)`.
  A `canonical_lead_events` unique index on `(tenant_id, idempotency_key)`
  guarantees one lead per logical event. Re-delivery updates the existing lead
  per dedupe policy instead of inserting.
- Email connector adds `Message-ID` dedupe at transport level.

## Retry

- Only **transient** failures retry (DB deadlock/timeout, object-storage blip,
  downstream 5xx). Parse/mapping/validation failures do **not** retry - they
  need a config or data fix.
- BullMQ job per event; exponential backoff `[10s, 30s, 2m, 10m, 1h]`, max 5
  attempts (per-source override allowed).
- `processing_attempts` and `last_error_code` recorded on the canonical event.
- Exhausted retries -> `DEAD_LETTER`.

## Replay

Replay re-runs the pipeline from a stored `raw_events` row. Options:

- **from raw** (default): re-adapt + re-map + validate + dedup + lead.
- **pinned profile**: replay against the mapping-profile version that was active
  at `received_at` (default) or against the current active version (for testing
  a fixed mapping).
- **dry run**: produce the `CanonicalLeadEvent` draft and dedupe decision
  without writing a lead or emitting events - used to verify a fix.

Replay is available to admin/support for `DEAD_LETTER` and (with permission)
`DONE` events. Every replay writes a new `integration_event_log` chain linked to
the original `correlation_id` and records `replay_of`.

Guardrails: replay respects idempotency (won't duplicate a lead), is
rate-limited, is audit-logged with actor, and bulk replay requires an explicit
confirmed batch action.

## Dead-letter handling

- DLQ entries surface in an admin/support UI with the failed stage, error code,
  human reason, and a payload snapshot.
- Actions: **edit-and-replay** (fix mapping profile or provide missing value),
  **replay as-is** (after upstream fix), **discard** (audited, requires reason).
- Alerting: DLQ depth and age thresholds raise an operational alert.

## Reconciliation

Per source, per day: counts of `received / done / needs_review / dead_letter`
plus provider-reported totals (when a provider exposes them) for drift
detection. Backed by `raw_events` + `integration_event_log`, not by the leads
table.

## Tenancy

All tables carry `tenant_id`, RLS-protected, plus application tenant guards.
`raw_body_ref` / `attachment_refs` point at tenant-scoped object-storage
prefixes.
