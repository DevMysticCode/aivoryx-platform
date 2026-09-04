# ADR 0017 — Generic Lead Ingestion Engine

Status: Accepted

## Context

Leads arrive from many sources over different transports. Building per-source
code paths would scatter provider and client logic through the CRM core and
violate the reusable-platform direction (ADR 0024).

## Decision

Build one **generic Lead Ingestion Engine** with a fixed canonical pipeline:

```
Source → Connector → Adapter → Mapping → Canonical Event → Validation → Deduplication → Lead → Assignment
```

- Each stage is independently observable and retryable and writes a status
  transition to `integration_event_log` with a correlation id.
- Provider and client behaviour is **configuration + adapters**, never core
  branching.
- The engine's responsibility ends when it emits `LeadCreated` / `LeadUpdated`
  on the outbox; the CRM assignment engine takes over.
- Tenant for an inbound event comes from the tenant-scoped `source` config,
  never the payload.

V1 builds the pipeline, the `webhook` and `email` connectors, `generic_json` /
`generic_form` / `generic_email_*` adapters, the mapping and custom-field
engines, and raw-event/replay/DLQ. V1 does **not** build Meta, Google, IndiaMART,
Justdial, Tata or Bonvoice adapters, or any provider-specific payload schema.

## Consequences

New providers become "add an adapter + mapping profile + source config". Detail
in `docs/architecture/LEAD-INGESTION.md`.
