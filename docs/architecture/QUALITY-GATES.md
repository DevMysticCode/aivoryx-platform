# Quality Gates

## Tooling

- Unit / integration: **Vitest** (ADR 0016).
- Browser / end-to-end: **Playwright** (ADR 0016).
- Types: `tsc --noEmit`. Lint: ESLint (incl. module-boundary rules). Format: Prettier.
- Secret scan: gitleaks (pre-commit + CI).

## Every PR

- typecheck
- lint
- Vitest unit/integration tests relevant to change
- Drizzle migration validation
- no secrets
- tenant isolation reviewed — new tenant-owned tables have an RLS policy **and**
  a registered application tenant guard (CI-enforced)
- API contract (code-first OpenAPI) regenerated and committed
- error codes drawn from the `packages/shared` catalogue
- UI states reviewed

## Critical workflow PRs

Also require Playwright coverage. The golden journeys
(`CLAUDE.md §15`) must stay green.

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
