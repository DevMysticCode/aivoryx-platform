# ADR 0005 — REST API, Code-First OpenAPI, `/api/v1`

Status: Accepted

## Decision
- The API is **REST**, versioned under `/api/v1`.
- The OpenAPI document is **code-first**: generated from NestJS controller and
  DTO decorators. The spec is a build artefact, committed and regenerated on
  every API change.
- The frontend API client and request/response types are generated from that
  document; hand-written request types are not allowed.
- Errors use stable machine-readable codes from the `packages/shared` catalogue
  and include a correlation id (ADR 0014).
- Unbounded lists are paginated; retryable external/event operations are
  idempotent.

## Reason
Code-first keeps one source of truth next to the implementation and reduces
frontend/backend contract drift, especially with AI-assisted development.
