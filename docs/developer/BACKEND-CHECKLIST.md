# Backend Checklist

Before coding:

- identify tenant boundary
- identify permission
- identify business invariant
- identify events/integrations
- check existing repository/service patterns

During coding:

- DTO validation
- authorization
- tenant filtering
- transaction boundaries
- stable errors
- audit where required
- idempotency for external events
- tests

Before PR:

- Drizzle migration included; forward-only, backward-compatible for one release
- new tenant-owned tables have forced RLS + a registered application tenant guard
- code-first OpenAPI regenerated and committed
- error codes taken from the `packages/shared` catalogue
- typecheck / lint / Vitest pass; Playwright for critical journeys
- logs contain correlation ID
- no secrets
- no direct cross-module table access (use application services + outbox events)
