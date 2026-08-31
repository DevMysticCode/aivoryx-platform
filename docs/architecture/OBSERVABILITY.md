# Observability and Client-Debugging

## Goal

A client should be able to give support a precise failure reference.

## Stack

Structured JSON logging with **Pino** (ADR 0014). Logs go to stdout and are
collected by the platform (Railway for API/workers, Vercel for web). A stable
**error-code catalogue** lives in `packages/shared` and is the single source of
truth; controllers and services reference catalogue constants, not string
literals.

## Correlation ID

Every request and important background event receives a correlation ID
(format `AIV-<ULID>`), created at the edge, propagated through the request and
any jobs it spawns via `AsyncLocalStorage`, and stamped on every log line and
domain/integration event.

Return it in API responses/headers where appropriate, and surface it in
user-facing error messages as the support reference.

## User-facing failure

Always show:
- concise failure statement
- safe reason
- next action
- reference ID

Example:
“Lead could not be assigned because no eligible telecaller is available. It has been queued for manual assignment. Reference: AIV-01J…”

## Log fields

- timestamp
- correlation_id
- tenant_id
- user_id
- module
- operation
- severity
- duration
- error_code
- external_provider
- external_event_id

Never log:
- passwords
- tokens
- secrets
- full payment credentials
- unnecessary personal data
- full call recordings

## Integration event lifecycle

Stage transitions are recorded append-only in `integration_event_log`, keyed by
correlation id. The full state model (RECEIVED → STORED → ADAPTING → MAPPING →
VALIDATING → DEDUPING → LEAD_UPSERT → EMITTED → DONE, with `*_FAILED` /
`INVALID` / `NEEDS_REVIEW` / `DEAD_LETTER` branches) is defined in
`RAW-EVENTS-AND-REPLAY.md`.

Admin/support can inspect and replay safe failed events; every replay links to
the original correlation id and is audit-logged.
