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
- migration included
- OpenAPI updated
- typecheck/lint/tests pass
- logs contain correlation ID
- no secrets
- no direct cross-module table access
