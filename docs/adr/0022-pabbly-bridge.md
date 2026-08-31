# ADR 0022 — Pabbly as a Temporary Bridge

Status: Accepted (refines ADR 0004)

## Context
IndiaMART and Justdial leads currently arrive via Pabbly. Pabbly must not become
a permanent architectural dependency, and their direct APIs/payloads are not yet
verified.

## Decision
Pabbly is a **connector transport only** (`pabbly_bridge`) — a constrained
`webhook` specialisation with a per-source shared secret and optional IP
allow-list. Relayed payloads flow through the identical pipeline as any other
source and are parsed by `generic_json` + a per-source mapping profile authored
from a real captured `raw_events` row. No Pabbly-specific or provider-specific
parsing code; no core module imports anything Pabbly-named; no
`if (transport === "pabbly")` business branching.

Migration: (1) all bridged leads via `pabbly_bridge`, capture real payloads;
(2) build a direct connector + adapter + profile for a verified provider, run
both paths in parallel, dedup by idempotency key, compare via reconciliation;
(3) disable the Pabbly source. The `pabbly_bridge` connector remains available
for any future bridged provider.

## Consequences
Pabbly can be removed per source without a code migration — only `source`
configuration changes. Detail in `docs/architecture/PABBLY-BRIDGE.md`.
