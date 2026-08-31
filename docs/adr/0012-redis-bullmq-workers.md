# ADR 0012 — Background Processing: Redis + BullMQ

Status: Accepted

## Context
External API calls, notifications, document processing, lead-ingestion pipeline
stages, integration retries/replay and heavy reporting must not run inside HTTP
requests.

## Decision
Use **Redis + BullMQ** workers on a **separate Railway service** with no public
port.

- One job per unit of work; queues named per domain concern.
- Retry with exponential backoff; only transient failures retry (ADR 0019).
- Each job persists and re-establishes its tenant context (`SET LOCAL
  app.tenant_id`) before touching tenant data — a job never trusts a
  `tenant_id` in its own payload for authorization.
- Redis persistence (AOF) is enabled so queued jobs survive a restart. Redis is
  never the sole system of record.
- Repeatable jobs (schedules) drive `rest_pull` connectors and reconciliation.

## Consequences
Clear async boundary and back-pressure. Redis is on the Railway private network
only. Queue depth/age is a monitored signal.
