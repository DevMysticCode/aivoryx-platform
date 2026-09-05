# Multi-Tenancy Architecture

Status: **Implemented for the identity model** in Phase 2 Task 2 (ADR 0027).
Later tenant-owned tables must follow the same pattern.

Covers decision 7: PostgreSQL Row Level Security **plus** application-level
tenant guards; tenant identity always from authenticated server context; never
trust a client-supplied `tenant_id`.

## Model

Single database, single schema, shared tables. Every tenant-owned row carries
`tenant_id uuid` (UUIDv7). Isolation is enforced twice, independently.

## Layer 1 - PostgreSQL Row Level Security (ADR 0027)

- Tenant-owned identity tables with `ENABLE` + `FORCE ROW LEVEL SECURITY`:
  `user_tenant_memberships`, `roles`, `role_permissions`, `membership_roles`,
  `tenants`, `tenant_invitations`, `outbox_events` (last two: ADR 0030),
  `leads`, `lead_activities`, `lead_notes`, `lead_followups`,
  `custom_field_definitions`, `custom_field_values`, `lead_sources`,
  `raw_events`, `canonical_lead_events`, `integration_event_log` (last eight:
  Phase 3, ADR 0031/0032), `field_agents`, `visits`, `visit_activities`,
  `visit_notes`, `visit_attachments` (last five: Phase 4, ADR 0033). `users`,
  `sessions`, global `permissions` have no RLS.
- Policy predicate:
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`, mirrored
  in `WITH CHECK`. `nullif(…, '')` because a touched custom GUC reverts to `''`
  on a pooled connection — an unset context must resolve to NULL (no rows), not
  raise. `user_tenant_memberships` also has a SELECT-only self-read policy
  (`user_id = app.user_id`) so a user can read their own memberships before a
  tenant is active. `tenant_invitations` similarly has a by-token policy
  (`token_hash = app.invitation_token_hash`) for the pre-context public
  invitation-accept flow (ADR 0030); `lead_sources` has an equivalent
  by-secret policy (`secret_hash = app.connector_secret_hash`) for the public
  inbound connector webhook (ADR 0032).
- The API runs every query as the non-privileged role **`aivoryx_app`**
  (`NOSUPERUSER`, `NOBYPASSRLS`, owns nothing) — the pool `SET ROLE`s to it on
  connect. `app.tenant_id` / `app.user_id` are set per transaction with
  `SET LOCAL` (`set_config(…, true)`) and revert at COMMIT/ROLLBACK; a pooled
  connection never carries one request's tenant into the next.
- Migrations + seed run as the `DATABASE_URL` owner (a separate handle, no
  `SET ROLE`), never to serve requests. **Migrations must run before the API
  starts** — `0003` creates `aivoryx_app`.
- Background jobs (BullMQ workers) will run the same `set_config` from the job's
  persisted tenant context before touching tenant data _(planned)_.

## Layer 2 - Application tenant guards (ADR 0028 / 0029)

- `SecurityGuard` (global `APP_GUARD`) resolves tenant context from the session
  cookie -> server-side session -> `sessions.active_membership_id` ->
  `user_tenant_memberships` (`tenant_id`; `user_id` verified against the
  session). Any `tenant_id` in a body, query or header — including an
  `X-Tenant-Id` header — is ignored.
- The resolved `SecurityContext` (`user`, `session`, `membership`, `tenantId`,
  `permissions`) is attached to `req` and bound to an AsyncLocalStorage; it is
  the single source of truth for the request.
- Every tenant-scoped DB access goes through `withTenantContext({ tenantId,
userId }, fn)` in `@aivoryx/db`. Explicit `tenant_id` filters in queries are
  belt-and-braces on top of RLS.
- Cross-tenant access would require an explicit, separately-authorized
  platform-admin path (none exists yet).

## Why both

RLS alone: easy to forget `SET LOCAL`. Guards alone: one missing `where` clause
leaks. Together — plus a non-privileged serving role — a leak needs a missing
app filter **and** a missing/blank `app.tenant_id` **and** the role gaining
`BYPASSRLS`/superuser.

## Tenant resolution for ingestion

Inbound integration events have no session. The tenant is taken from the
`source` configuration row (itself tenant-scoped) that the connector endpoint or
mailbox rule resolved. Payload contents never determine tenant.

## Testing

- `apps/api/test/rls.int.spec.ts` — cross-tenant read/write/insert attempts run
  as `aivoryx_app` directly against PostgreSQL and must return 0 rows / raise
  `42501`; proves RLS, not an app `WHERE`, is the boundary.
- `packages/db/src/schema/rls.test.ts` — asserts ENABLE+FORCE+policy presence on
  every tenant-owned table and that `aivoryx_app` is non-privileged.
- `apps/api/test/tenant-context.int.spec.ts` — the `SET LOCAL` context does not
  leak between transactions or concurrent requests.
- All gated on `RUN_DB_IT=1` (real PostgreSQL). A CI job with a Postgres service
  container to run them always-on is a follow-up; likewise a CI check that every
  new tenant-owned table has an RLS policy + `rls.test.ts` coverage.

## Out of scope for V1

Schema-per-tenant, database-per-tenant, and tenant-aware connection pooling
beyond a single pooled app role. Revisit only if a tenant's scale or a
compliance requirement forces it.
