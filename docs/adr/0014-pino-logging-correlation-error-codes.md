# ADR 0014 — Structured Logging: Pino, Correlation IDs, Stable Error Codes

Status: Accepted

## Context
A client giving support a request must be traceable end-to-end across the web
app, API, workers and integration pipeline (`OBSERVABILITY.md`).

## Decision
- **Pino** JSON logging to stdout; collected by the platform (Railway / Vercel).
- A **correlation id** (`AIV-<ULID>`) is created at the edge, propagated through
  the request and any jobs it spawns via `AsyncLocalStorage`, stamped on every
  log line, domain event and integration-event-log row, and returned to clients
  (header / error body).
- A **stable error-code catalogue** in `packages/shared` is the single source of
  truth; code references catalogue constants. Each code maps to an HTTP status
  and a safe user message.
- Standard log fields: timestamp, correlation_id, tenant_id, user_id, module,
  operation, severity, duration, error_code, external_provider,
  external_event_id.
- Never log secrets, tokens, full payment credentials, unnecessary PII, or full
  call recordings.

## Consequences
Every failure yields an actionable reference. Adding an error code is a reviewed
change. Detail in `docs/architecture/OBSERVABILITY.md`.
