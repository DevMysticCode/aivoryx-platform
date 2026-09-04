# ADR 0018 — Connector / Adapter Separation

Status: Accepted

## Context

"How a payload arrives" and "what shape a payload is" change independently. Mixing
them produces transport code that knows provider fields and provider code that
knows HTTP.

## Decision

Two distinct, composable concerns:

- **Connector** — transport only. Normalises input into a common
  `InboundEnvelope` and performs transport-level authentication. Types are
  extensible: `webhook`, `email`, `rest_pull`, `pabbly_bridge`,
  `manual_csv` (later).
- **Adapter** — a **pure function** `(raw_body, envelope) → ProviderDraft` that
  understands exactly one provider's (or one generic) structure. No DB, no
  network, no `if (provider === …)` outside the adapter's own module.

Adapter selection is configuration on the `source` (`adapter_key`), resolved
through a static adapter registry.

## Consequences

A new provider on an existing transport = one adapter + one mapping profile. A
new transport = one connector. Detail in
`docs/architecture/CONNECTORS-AND-ADAPTERS.md`.
