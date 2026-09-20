# Integration & Lead Ingestion Overview

Status: Approved architecture. No application code exists yet.

This is the map. Detail lives in the dedicated documents linked below.

## Goal

A generic, reusable **Aivoryx Lead Ingestion Engine** (ADR 0017) that turns any
external lead signal into a validated, deduplicated, tenant-scoped lead. Replace
Pabbly gradually (ADR 0022) without building a Zapier/Pabbly clone. No provider-
specific or client-specific rule in the engine core (ADR 0024).

## Canonical pipeline

```
Source → Connector → Adapter → Mapping → Canonical Event → Validation → Deduplication → Lead → Assignment
```

| Stage           | Responsibility                                                                         | Document                               |
| --------------- | -------------------------------------------------------------------------------------- | -------------------------------------- |
| Source          | tenant-scoped config: provider key, connector, adapter, mapping profile, dedupe policy | `LEAD-INGESTION.md`                    |
| Connector       | transport only — how the payload arrived; transport-level auth                         | `CONNECTORS-AND-ADAPTERS.md`           |
| Adapter         | provider shape → provider-canonical draft (pure function, one provider each)           | `CONNECTORS-AND-ADAPTERS.md`           |
| Mapping         | provider fields → canonical Aivoryx fields + tenant custom fields                      | `FIELD-MAPPING.md`, `CUSTOM-FIELDS.md` |
| Canonical Event | persist `raw_events` + `canonical_lead_events` in one transaction                      | `RAW-EVENTS-AND-REPLAY.md`             |
| Validation      | schema + tenant rules; failures dead-lettered, never dropped                           | `RAW-EVENTS-AND-REPLAY.md`             |
| Deduplication   | configurable match vs existing leads/customers                                         | `LEAD-INGESTION.md`                    |
| Lead            | create or merge/link; emit `LeadCreated`/`LeadUpdated` via outbox                      | `LEAD-INGESTION.md`                    |
| Assignment      | CRM assignment engine consumes the domain event                                        | CRM docs                               |

## Connector types (extensible)

`webhook`, `email`, `rest_pull`, `pabbly_bridge`, `manual_csv` (later).
See `CONNECTORS-AND-ADAPTERS.md` and, for email, `EMAIL-INGESTION.md`.

## Known lead sources and their current channel

| Source           | Channel today                    | Notes                                                           |
| ---------------- | -------------------------------- | --------------------------------------------------------------- |
| Tata             | email connector + parsing config | generic email, no hard-coded Tata rules (ADR 0023)              |
| IndiaMART        | Pabbly bridge                    | direct adapter later, after API/payload verification (ADR 0022) |
| Justdial         | Pabbly bridge                    | direct adapter later, after API/payload verification (ADR 0022) |
| Meta Ads forms   | webhook (planned)                | adapter NOT built yet; no payload invented                      |
| Google Ads forms | webhook (planned)                | adapter NOT built yet; no payload invented                      |
| Website forms    | webhook (`generic_form`)         | first real end-to-end path                                      |

Provider-specific payload shapes are **not yet available and must not be
invented** (decision 20). Meta, Google, IndiaMART, Justdial, Tata and Bonvoice
adapters are **not implemented in V1**.

## Raw events, idempotency, retry, replay, dead-letter

Every inbound payload is persisted verbatim in `raw_events` before parsing, for
debugging, reconciliation, replay and idempotency (ADR 0019). Full state model,
retry policy, replay modes and dead-letter handling in
`RAW-EVENTS-AND-REPLAY.md`.

## Pabbly migration

Stage 1: provider → Pabbly → Aivoryx `pabbly_bridge`.
Stage 2: direct connector + adapter for a verified provider, run in parallel,
deduped by idempotency key, compared via reconciliation.
Stage 3: disable the Pabbly source; the `pabbly_bridge` connector stays
available but unused. See `PABBLY-BRIDGE.md`.

## Beyond lead ingestion

The same connector/adapter contracts are intended to serve outbound REST
actions and other inbound events later. Anything beyond lead ingestion is out of
scope for V1.

## Webhook hardening and retention (UC-1)

Decisions and rationale: [ADR 0048](../adr/0048-inbound-webhook-hardening-and-raw-event-retention.md).

| Setting                             | Default | Meaning                                                             |
| ----------------------------------- | ------- | ------------------------------------------------------------------- |
| `WEBHOOK_MAX_BODY_BYTES`            | 262144  | Max body of the public webhook (413 `PAYLOAD_TOO_LARGE` above it)   |
| `WEBHOOK_RATE_LIMIT_MAX`            | 120     | Burst per authenticated source (429 `RATE_LIMITED` + `Retry-After`) |
| `WEBHOOK_RATE_LIMIT_WINDOW_SECONDS` | 60      | Full refill time (sustained rate = MAX / WINDOW)                    |
| `RAW_EVENT_RETENTION_DAYS`          | 30      | Age after which a raw payload may be purged                         |
| `RAW_EVENT_PURGE_BATCH_SIZE`        | 500     | Rows per purge batch                                                |
| `RAW_EVENT_PURGE_INTERVAL_MINUTES`  | 60      | Time between purge runs                                             |
| `RAW_EVENT_PURGE_ENABLED`           | true    | Run the in-process purge job                                        |

Raw event lifecycle: `RECEIVED` -> `PROCESSED` (done, or a duplicate logical event) | `FAILED`
(validation/mapping failure, or an unexpected error recorded as `PROCESSING_ERROR`). A failed event
can be replayed by an admin; a provider retry of an unexpectedly failed delivery is reprocessed.
