# ADR 0009 — Multi-Tenancy: PostgreSQL RLS + Application Guards

Status: Accepted

## Context

`CLAUDE.md §5` requires cross-tenant access to be impossible by default. A single
mechanism is a single point of failure: a forgotten `SET LOCAL` defeats RLS
alone; a missing `where tenant_id = ?` defeats guards alone.

## Decision

Enforce tenant isolation **twice, independently**:

1. **PostgreSQL RLS** — every tenant-owned table has RLS enabled and forced,
   with policies keyed on `current_setting('app.tenant_id')`. The application
   sets `app.tenant_id` / `app.user_id` / `app.role_scope` via `SET LOCAL` at
   the start of every request/job transaction. The serving DB role has no
   `BYPASSRLS`.
2. **Application tenant guards** — tenant context is resolved from the
   authenticated session (or, for ingestion, the tenant-scoped `source` config),
   never from client input or payload body. The data layer requires an explicit
   `tenant_id` filter for every tenant-owned table.

Cross-tenant access is only possible via explicit, separately-authorized
platform-admin services that are audit-logged.

## Consequences

A leak requires two independent code mistakes plus a misconfigured DB role. CI
blocks any new tenant-owned table lacking an RLS policy or a guard registration.
A standing test suite attempts cross-tenant reads/writes and must fail. Detail in
`docs/architecture/TENANCY.md`.

## Implementation (ADR 0027)

Phase 2 Task 2 implements this for the identity model: the non-privileged
`aivoryx_app` role, `ENABLE`+`FORCE` RLS + policies on
`user_tenant_memberships` / `roles` / `role_permissions` / `membership_roles` /
`tenants`, and per-transaction `SET LOCAL app.tenant_id` / `app.user_id` via
`@aivoryx/db` helpers. Cross-tenant isolation is proven directly against
PostgreSQL in `apps/api/test/rls.int.spec.ts`.
