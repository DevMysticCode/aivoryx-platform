# Lead Ingestion Engine

Status: Approved architecture. No application code exists yet.

## Purpose

A single, provider-neutral engine that turns any external lead signal into a
validated, deduplicated, tenant-scoped `lead` record ready for assignment.

It is a reusable Aivoryx platform capability. No client-specific or
provider-specific business rule belongs in the engine core. Provider and client
behaviour is expressed as **configuration and adapters**, never as branches in
core code.

## Canonical pipeline

```
Source
  -> Connector        (transport: how the payload arrives)
  -> Adapter           (provider shape -> raw canonical draft)
  -> Mapping           (provider/tenant field map -> canonical + custom fields)
  -> Canonical Event   (RawEvent + CanonicalLeadEvent persisted)
  -> Validation        (schema + tenant rules)
  -> Deduplication     (match against existing leads/customers)
  -> Lead              (create or merge/link)
  -> Assignment        (hand off to CRM assignment engine)
```

Each stage is independently observable, independently retryable, and writes a
status transition to the integration event log with a correlation ID.

## Stage responsibilities

### 1. Source

A configured origin of leads for a tenant. Examples currently known:
Tata (email), IndiaMART (Pabbly bridge), Justdial (Pabbly bridge),
Meta Ads forms, Google Ads forms, Website forms.

A source record carries: tenant, provider key, connector type, adapter key,
mapping profile reference, dedupe policy reference, enabled flag, secret
reference, and free-form provider config (opaque to core).

Provider-specific payload shapes are **not yet known** and are **not modelled
here**. Sources are created as configuration once real payloads are available.

### 2. Connector (transport)

Normalises _how_ a payload arrives into a common `InboundEnvelope`
(headers/metadata + raw body + received timestamp + source reference).
Connector types are extensible: `webhook`, `email`, `rest_pull`, `pabbly_bridge`,
`manual_csv` (later). See `CONNECTORS-AND-ADAPTERS.md`.

The connector performs transport-level authentication only (shared secret,
signature verification, mailbox auth, API credential). It does **not** parse
business fields.

### 3. Adapter (provider shape)

Converts a provider's raw body into a **provider-canonical draft**: a flat,
typed key/value set using the provider's own field names, plus attachments and
provider record identifiers. The adapter is the only place that knows a specific
provider's structure.

Adapters are pure and side-effect free: `(rawBody, envelope) -> ProviderDraft`.
No adapter is implemented yet. The interface and a `generic_json` /
`generic_form` fallback adapter are the only planned V1 artefacts.

### 4. Mapping

Applies the tenant's mapping profile for that source: provider field ->
canonical Aivoryx field, and provider field -> tenant custom field. Handles
type coercion, defaulting, constants, and simple transforms. See
`FIELD-MAPPING.md`.

### 5. Canonical Event

Two durable records are written in one transaction:

- `RawEvent` - the untouched inbound payload + envelope (see
  `RAW-EVENTS-AND-REPLAY.md`).
- `CanonicalLeadEvent` - the mapped, still-unvalidated canonical draft, linked
  to the `RawEvent` by id.

Everything downstream operates on `CanonicalLeadEvent` and can be **replayed**
from `RawEvent` without re-contacting the provider.

### 6. Validation

Schema validation of the canonical draft (required identity fields, formats),
then tenant-configurable rules (e.g. reject if no phone and no email). Failures
move the event to `INVALID` and, depending on policy, to the dead-letter queue
for manual correction/replay. Validation never silently drops an event.

### 7. Deduplication

Matches the candidate against existing `leads` / `customers` within the tenant
using a configurable match policy (e.g. normalised phone, normalised email,
provider record id). Outcomes: `new`, `duplicate_merge`, `duplicate_link`,
`ambiguous` (routed to manual review). Deterministic and logged.

### 8. Lead

Creates a new `lead` or merges/links per the dedupe outcome. Emits
`LeadCreated` / `LeadUpdated` via the transactional outbox.

### 9. Assignment

The engine's responsibility ends by emitting the domain event. The CRM
assignment engine consumes it (assignment rules, SLA/call task creation) and is
documented under CRM, not here.

## Idempotency

Every inbound event is assigned an **idempotency key**: provider record id when
supplied, otherwise a hash of `(source_id, canonical identity fields, provider
timestamp)`. Re-delivery of the same key is recognised at the Canonical Event
stage and does not create a second lead. See `RAW-EVENTS-AND-REPLAY.md`.

## Tenancy

Every table in the engine carries `tenant_id`, is protected by PostgreSQL RLS,
and is additionally filtered by application-level tenant guards. The tenant for
an inbound event is resolved from the **source configuration** (which is itself
tenant-scoped), never from the payload body.

## Failure model

| Stage         | Failure                 | Handling                                                              |
| ------------- | ----------------------- | --------------------------------------------------------------------- |
| Connector     | bad signature / auth    | reject at edge, log, no RawEvent unless policy says store-then-reject |
| Adapter       | unparseable body        | store RawEvent, mark `ADAPTER_FAILED`, DLQ                            |
| Mapping       | missing mapping profile | store RawEvent, mark `MAPPING_FAILED`, DLQ                            |
| Validation    | invalid canonical draft | `INVALID`, DLQ, manual correct + replay                               |
| Deduplication | ambiguous match         | `NEEDS_REVIEW`, manual resolution                                     |
| Lead          | transient DB error      | retry with backoff via BullMQ                                         |
| Assignment    | no eligible assignee    | lead persisted, queued; actionable error + reference id               |

## What V1 builds

- The pipeline stages and their status model.
- `webhook` and `email` connectors; `rest_pull` and `pabbly_bridge` interfaces.
- `generic_json` / `generic_form` adapters only.
- Mapping profile engine + tenant custom-field engine.
- RawEvent store, idempotency, retry, replay, dead-letter.
- Manual review UI for `NEEDS_REVIEW` / DLQ.

## What V1 explicitly does NOT build

- Meta, Google, IndiaMART, Justdial, Tata, or Bonvoice adapters.
- Any provider-specific payload schema.
- A general workflow/automation engine (see open decisions).
