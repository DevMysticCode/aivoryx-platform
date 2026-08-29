# Quality Gates

## Every PR

- typecheck
- lint
- unit/integration tests relevant to change
- migration validation
- no secrets
- tenant isolation reviewed
- API contract updated
- UI states reviewed

## Critical workflow PRs

Also require Playwright coverage.

## Before client pilot

- clean production environment
- backups
- restore test
- monitoring
- error reference system
- integration retry/replay
- role/permission verification
- mobile/PWA test
- UAT checklist
- migration/reconciliation plan
