# Pabbly Bridge Architecture

Status: Approved architecture. No application code exists yet.

Covers decisions 22 and 27: Pabbly is a **temporary bridge**, not a permanent
architectural dependency. IndiaMART and Justdial currently arrive via Pabbly;
direct adapters may be added later once their real API/payload capabilities are
verified.

## Position in the pipeline

Pabbly is a **connector transport only** (`pabbly_bridge`). It relays a payload
that originated at a real provider. Once inside Aivoryx the event flows through
the identical pipeline as any other source:

```
Provider (IndiaMART / Justdial / ...) --> Pabbly workflow --> Aivoryx pabbly_bridge webhook
   --> raw_events --> adapter --> mapping --> canonical event --> validation --> dedup --> lead --> assignment
```

Nothing downstream of `raw_events` knows or cares that Pabbly was involved.

## pabbly_bridge connector

A constrained specialisation of the `webhook` connector:

- **Dedicated endpoint** per tenant (or per source), e.g.
  `POST /api/v1/ingest/pabbly/{sourceKey}`.
- **Authentication:** static shared secret (header/bearer) issued per source +
  IP allow-list if Pabbly publishes stable egress ranges. HMAC signature if/when
  available.
- **Envelope metadata:** records that `transport = pabbly_bridge`, the Pabbly
  workflow identifier if provided, and the _claimed_ origin provider key from
  configuration (never trusted from the body for routing).
- **Body:** stored verbatim in `raw_events`. Pabbly-shaped bodies are handled by
  a `generic_json` adapter plus a per-source mapping profile - **no
  Pabbly-specific or provider-specific parsing code**.
- The origin provider for a Pabbly source is fixed on the `source` config, so
  IndiaMART-via-Pabbly and Justdial-via-Pabbly are two separate sources with two
  mapping profiles.

## What must NOT happen

- No `if (transport === "pabbly")` business branching outside the connector.
- No Pabbly workflow logic replicated in Aivoryx.
- No assumption about IndiaMART/Justdial field names until real samples exist;
  the mapping profile is authored from an actual captured `raw_events` row.
- No core module importing anything Pabbly-named.

## Migration path (three stages)

| Stage | State                           | Action                                                                                                                                                                                 |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Now                             | All IndiaMART/Justdial (and any other bridged) leads enter via `pabbly_bridge`. Capture real `raw_events`.                                                                             |
| 2     | After provider API verification | Build a direct connector (`webhook` or `rest_pull`) + provider adapter + mapping profile. Run **both** paths in parallel, dedup by idempotency key, compare counts via reconciliation. |
| 3     | After parallel run is clean     | Disable the Pabbly source, delete the Pabbly workflow. The `pabbly_bridge` connector code remains available for any future bridged provider but has no active source.                  |

Each stage transition is an operational change to `source` configuration, not a
code migration.

## Idempotency across the switchover

During Stage 2 the same logical lead may arrive twice (once via Pabbly, once
direct). The business idempotency key (`provider_record_id` when present, else
the identity hash) collapses them to a single lead. Reconciliation reports any
key seen on only one path.

## Removal criteria (Definition of Done for "Pabbly removed")

- Direct path has run in parallel for an agreed window with < agreed drift.
- All DLQ entries from the direct path resolved.
- Mapping profile for the direct source reviewed and marked `active`.
- Runbook updated; Pabbly workflow archived, secret revoked.
