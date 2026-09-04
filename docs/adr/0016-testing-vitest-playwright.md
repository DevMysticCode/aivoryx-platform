# ADR 0016 — Testing: Vitest + Playwright

Status: Accepted

## Context

`CLAUDE.md §15` requires typecheck, lint, unit tests for business logic,
integration/API tests, and Playwright for critical journeys. The earlier draft
left the unit runner as "Vitest/Jest as appropriate".

## Decision

- **Vitest** for all unit and integration tests, across `apps/*` and
  `packages/*` (one runner, one config style).
- **Playwright** for browser and end-to-end tests, covering the golden journeys
  in `CLAUDE.md §15`.
- Integration/API tests run against a real PostgreSQL + Redis (compose or
  ephemeral), not mocks, so RLS and guards are exercised.
- A standing suite attempts cross-tenant access and must fail (ADR 0009).
- Mapping profiles and adapters are tested offline from stored `raw_events`.

## Consequences

Consistent tooling and mental model. CI gates: typecheck, lint, Vitest,
Playwright (critical paths), Drizzle migration validation, secret scan.
