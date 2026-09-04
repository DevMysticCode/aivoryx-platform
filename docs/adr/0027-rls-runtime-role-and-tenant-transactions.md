# ADR 0027 — Runtime DB Role, RLS Enforcement & Per-Transaction Tenant Context

Status: Accepted (Phase 2, Task 2 — security boundary)

Implements ADR 0009 (multi-tenancy: RLS + application guards). Refined by nothing yet.

## Context

ADR 0009 requires tenant isolation enforced **twice**: PostgreSQL Row Level
Security _and_ application guards. Task 2 makes the RLS half real for the
identity model, and settles how the application supplies `app.tenant_id` without
a global mutable variable and without a connection ever carrying one request's
tenant into the next.

## Decision

### A non-privileged runtime role

- Migration `0003` creates role **`aivoryx_app`**: `NOLOGIN NOSUPERUSER
NOBYPASSRLS NOCREATEDB NOCREATEROLE`, granted only `SELECT/INSERT/UPDATE/DELETE`
  on `public` tables and `USAGE/SELECT` on sequences (plus `ALTER DEFAULT
PRIVILEGES` so future tables inherit the grant). It owns nothing and runs no
  DDL.
- The API's connection pool issues **`SET ROLE "aivoryx_app"`** on every physical
  connection (`createDb({ appRole })` → pool `connect` handler). Every
  application query therefore runs as `aivoryx_app`, so RLS always applies — even
  a query that forgot its tenant filter returns nothing rather than leaking.
- Migrations and the seed script use a **separate handle with no `SET ROLE`**,
  running as the `DATABASE_URL` owner. That role may be a superuser locally
  (docker) or a near-superuser on Railway; it is never used to serve requests.
- `GRANT "aivoryx_app" TO current_user` in `0003` lets the connection user
  `SET ROLE` into it. **Deployment note:** if the API and the migrator use
  different DB users, the API's user also needs this grant, and the API user must
  not be a superuser.

### RLS on the tenant-owned identity tables

`ENABLE` **and** `FORCE ROW LEVEL SECURITY` on:
`user_tenant_memberships`, `roles`, `role_permissions`, `membership_roles`, and
`tenants`. `users`, `sessions` and the global `permissions` catalogue are
deliberately left without RLS.

Policy predicate (all tables):

```
tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
```

- `current_setting(…, true)` returns NULL when unset; but once a custom GUC has
  been touched on a pooled connection it reverts to **`''`**, and `''::uuid`
  raises. `nullif(…, '')` makes an unset context resolve to NULL → **no rows**
  (fail closed), never an error.
- `WITH CHECK` mirrors `USING`, so an insert/update cannot place a row in another
  tenant (verified: raises `42501`).
- `user_tenant_memberships` additionally has **`utm_self_read` (SELECT-only)**:
  `user_id = nullif(current_setting('app.user_id', true), '')::uuid`. A user may
  always read their **own** membership rows — required to resolve tenant context
  before a tenant is active and for `/auth/me`. Consequence: within a tenant
  context a user also sees their own membership rows in other tenants; this is
  their own data and is documented, not a leak.
- `tenants` policy: visible if `id = app.tenant_id` **or** the current
  `app.user_id` has a membership in it — lets `/auth/me` list the user's
  workspaces without exposing the tenant registry.

### Per-transaction context, never global

`@aivoryx/db` exposes three helpers; nothing sets a tenant "globally":

| helper                                    | sets                            | use                                           |
| ----------------------------------------- | ------------------------------- | --------------------------------------------- |
| `withAppTransaction`                      | — (just the `aivoryx_app` role) | `users`, `sessions`                           |
| `withUserContext(userId)`                 | `app.user_id`                   | resolve memberships before a tenant is picked |
| `withTenantContext({ tenantId, userId })` | `app.user_id` + `app.tenant_id` | every tenant-scoped read/write                |

They set values with `select set_config('app.tenant_id', $1, true)` — the
parameterised form of `SET LOCAL`, so PostgreSQL reverts them at COMMIT/ROLLBACK.
A pooled connection reused by the next request starts with the context unset;
`nullif` makes that mean "no rows". Two concurrent tenant transactions run on
different pooled connections and cannot see each other's `SET LOCAL` values.

### Ordering constraint

Migration `0003` creates `aivoryx_app`. The API's pool `SET ROLE`s to it on
connect, so **migrations must run before the API starts** (`db:migrate` then the
service). A connection made before `0003` fails loudly rather than running
unrestricted.

## Consequences

- A cross-tenant leak now needs: a missing app filter **and** a missing/blank
  `app.tenant_id` **and** the serving role somehow gaining `BYPASSRLS`/superuser
  — three independent failures.
- Hand-authored migration (`0003`); drizzle-kit does not model roles/grants/RLS,
  so `meta/0003_snapshot.json` equals `0002` and `db:generate` reports no drift.
- `apps/api/test/rls.int.spec.ts` exercises RLS directly as `aivoryx_app`;
  `packages/db/src/schema/rls.test.ts` asserts ENABLE+FORCE+policy presence;
  `apps/api/test/tenant-context.int.spec.ts` proves no cross-transaction leak.
- New tenant-owned tables in later phases must add the same ENABLE+FORCE+policy;
  `rls.test.ts` should be extended to cover them (a CI gate on this is a
  follow-up).
