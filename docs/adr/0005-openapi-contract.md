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

## Generation pipeline (Phase 1 — accepted)

The OpenAPI document is produced by `apps/api/scripts/extract-openapi.mjs`:

1. `pnpm --filter @aivoryx/api openapi:extract` builds the API, then the script
   creates the Nest application container from the built `dist/` graph
   **without** calling `listen()` and **without** opening any DB/Redis/network
   connection (`OPENAPI_GENERATION=1`, placeholder env), calls
   `buildOpenApiDocument(app)`, and `app.close()`s immediately.
2. The document is written to `packages/contracts/openapi/openapi.json`
   (committed).
3. `pnpm --filter @aivoryx/contracts generate` runs `openapi-typescript` to emit
   `packages/contracts/src/generated/schema.ts` (committed); the web client in
   `apps/web/lib/api` consumes those types.

This container-instantiation approach is **accepted as-is for Phase 1**. It is
deterministic in CI and needs no running server.

### Possible future revision (not a Phase 1 blocker)

A fully static emit (deriving the document from decorator metadata via the
TypeScript compiler API / a Nest CLI plugin, with no application
instantiation at all) may be revisited later if container instantiation becomes
slow or awkward in CI. There is no need to change it now.
