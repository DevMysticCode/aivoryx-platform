# ADR 0004 — Aivoryx Integration Engine

Status: Accepted. Refined by ADR 0017–0023.

## Decision

Build a lightweight reusable integration engine with webhooks, REST connectors, mapping, conditions, actions, retries and logs.

Do not build a full Pabbly/Zapier clone in the first release.

The first concrete implementation is the **Lead Ingestion Engine** with the
canonical pipeline
`Source → Connector → Adapter → Mapping → Canonical Event → Validation →
Deduplication → Lead → Assignment` (ADR 0017). Connector/adapter separation is
ADR 0018; raw-event persistence and replay ADR 0019; custom fields ADR 0020;
field mapping ADR 0021; Pabbly-as-bridge ADR 0022; generic email ADR 0023.

## Reason

The client currently depends on Pabbly, and integration is a reusable Aivoryx capability. The first implementation should remove dependency progressively without creating a second product that delays the client system.
