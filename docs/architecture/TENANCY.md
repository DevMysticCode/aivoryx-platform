# Multi-Tenancy Architecture

Status: Approved architecture. No application code exists yet.

Covers decision 7: PostgreSQL Row Level Security **plus** application-level
tenant guards; tenant identity always from authenticated server context; never
trust a client-supplied `tenant_id`.

## Model

Single database, single schema, shared tables. Every tenant-owned row carries
`tenant_id uuid` (UUIDv7). Isolation is enforced twice, independently.

## Layer 1 - PostgreSQL Row Level Security (last line of defence)

- Every tenant-owned table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` +
  `FORCE ROW LEVEL SECURITY`.
- Policy shape (illustrative, not code):
  `USING (tenant_id = current_setting('app.tenant_id')::uuid)` and the same as
  `WITH CHECK` for writes.
- The application sets `app.tenant_id` (and `app.user_id`, `app.role_scope`) via
  `SET LOCAL` at the start of every request/job transaction, from authenticated
  context only.
- The application's runtime DB role is **not** a superuser and does **not** have
  `BYPASSRLS`.
- A separate migration/admin role (used only by Drizzle migrations and operator
  tooling) may bypass RLS; it is never used to serve requests.
- Background jobs (BullMQ workers) run the same `SET LOCAL` from the job's
  persisted tenant context before touching tenant data.

## Layer 2 - Application tenant guards (primary, explicit)

- Tenant context is resolved by a NestJS middleware/guard from the session
  cookie -> server-side session -> `tenant_id`. Any `tenant_id` in a body, query
  or header is ignored for authorization (may only be used by platform-admin
  endpoints that are separately guarded).
- A request-scoped `TenantContext` is the single source of truth for the rest of
  the request.
- The Drizzle data-access layer is wrapped so every query for a tenant-owned
  table requires an explicit `tenant_id` filter derived from `TenantContext`;
  a query without it fails fast in development and is blocked in production.
- Cross-tenant access is only possible through explicit, separately-authorized
  "platform admin" services that opt out deliberately and are audit-logged.

## Why both

RLS alone: easy to forget `SET LOCAL`, and an ORM misconfiguration or a raw
query on the admin role silently leaks. Guards alone: one missing `where` clause
leaks. Together, a leak requires **two** independent mistakes plus a
misconfigured DB role.

## Tenant resolution for ingestion

Inbound integration events have no session. The tenant is taken from the
`source` configuration row (itself tenant-scoped) that the connector endpoint or
mailbox rule resolved. Payload contents never determine tenant.

## Testing (required)

- A standing integration test attempts cross-tenant reads/writes on every
  tenant-owned repository and must fail to retrieve or mutate foreign rows.
- RLS policy presence is asserted by a schema test (every tenant table has RLS
  enabled + forced).
- CI blocks merge if a new tenant-owned table lacks an RLS policy or a guard
  registration.

## Out of scope for V1

Schema-per-tenant, database-per-tenant, and tenant-aware connection pooling
beyond a single pooled app role. Revisit only if a tenant's scale or a
compliance requirement forces it.
