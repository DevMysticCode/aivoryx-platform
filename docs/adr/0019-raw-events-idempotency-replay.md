# ADR 0019 — Raw Events, Idempotency, Retry, Replay, Dead-Letter

Status: Accepted

## Context
Provider payloads are the only ground truth for debugging a bad lead, and
providers re-deliver. We must never lose an inbound payload or silently drop an
event.

## Decision
- **Persist the raw payload first.** `raw_events` is written verbatim (body in
  R2 by reference for large bodies, small inline), in its own transaction,
  before any parsing.
- **Idempotency.** Transport exact-duplicate detection via `raw_hash`; business
  idempotency key = `provider_record_id` when present, else a hash of
  `source_id + normalised phone + normalised email + provider timestamp`. A
  unique index on `canonical_lead_events(tenant_id, idempotency_key)` guarantees
  one lead per logical event.
- **Retry.** Only transient failures retry (BullMQ, exponential backoff, capped
  attempts). Parse/mapping/validation failures do not retry — they need a fix.
- **Replay.** Re-run the pipeline from a stored `raw_events` row: from-raw,
  pinned-profile-version, or dry-run. Replay respects idempotency, is
  rate-limited and audit-logged.
- **Dead-letter.** Non-transient failures and exhausted retries go to
  `dead_letter_events` with stage, error code and reason; an admin/support UI
  offers edit-and-replay, replay-as-is, or discard (audited).
- **Reconciliation.** Per-source daily counts (received/done/needs_review/
  dead_letter) vs provider-reported totals where available.

## Consequences
Every failure is recoverable and inspectable. Storage cost for raw bodies is
managed by per-tenant retention + lifecycle rules. Detail in
`docs/architecture/RAW-EVENTS-AND-REPLAY.md`.
