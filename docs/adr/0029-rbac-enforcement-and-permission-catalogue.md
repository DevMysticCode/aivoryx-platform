# ADR 0029 — RBAC Enforcement, Permission Catalogue & Initial Platform Roles

Status: Accepted (Phase 2, Task 2 — security boundary)

Implements ADR 0011 (scope-aware RBAC). Uses the model from ADR 0026.

## Decision

### One catalogue, in `packages/shared`

`PERMISSION_DEFINITIONS` in `@aivoryx/shared` is the single source of truth
(ADR 0011). Keys are `<resource>.<action>`, stable once shipped. The initial
set is deliberately small — identity/admin only:

```
users.read        users.create   users.update   users.delete
memberships.read  memberships.update
roles.read        roles.create   roles.update   roles.delete
permissions.read
tenants.read      tenants.update
```

`permissions` rows are **seeded** from this list by `pnpm db:seed`
(`seedPermissions`, idempotent upsert). CRM / HR / field / finance permissions
are added by their own modules later — never here.

### One generic platform role

`TENANT_ADMIN` (key `PLATFORM_ROLE_KEYS.tenantAdmin`) holds the **entire
catalogue**. `provisionTenantAdmin(handle, { tenantId, actingUserId,
membershipId? })` idempotently creates it in a tenant, grants every catalogue
permission, and optionally assigns it to a membership. It runs inside a
tenant-context transaction so RLS `WITH CHECK` passes even for the owner role.

No business roles (`telecaller`, `field_agent`, `sales_manager`, `hr_manager`, …)
exist in the platform core. Tenants define their own roles later.

### Enforcement

- `@RequirePermission('roles.read')` on a controller action (metadata +
  `@ApiCookieAuth`). Implies a resolved active tenant.
- The global **`SecurityGuard`** (ADR 0027 / 0028) resolves the request:

  1. no / bad cookie → **401 `AUTH_UNAUTHENTICATED`**
  2. revoked / expired session → **401 `AUTH_SESSION_*`**
  3. tenant route, no active membership → **403 `AUTH_NO_ACTIVE_TENANT`**
     (details list the user's memberships so a client can switch)
  4. active membership suspended / tenant suspended → **403 `AUTH_MEMBERSHIP_SUSPENDED` / `TENANT_SUSPENDED`**
  5. authenticated, permission not held → **403 `AUTH_FORBIDDEN`** (details name the missing permission)

  401 (who are you?) and 403 (you may not) are never conflated. On an
  `@AuthOnly()` route a suspended tenant is tolerated (the response is
  tenant-less) so the user can still `switch-tenant`.

- Permissions are resolved **per active membership**:
  `RbacService.permissionsForMembership` reads
  `membership_roles ⋈ role_permissions ⋈ permissions` inside
  `withTenantContext`, so RLS restricts the join to the active tenant. A role or
  grant from another tenant is invisible and **cannot authorize anything** —
  proven by a test where a `TENANT_ADMIN` in tenant A gets 403 in tenant B.

- `lib/permissions` on the frontend (later) mirrors the catalogue for
  show/hide only; the server re-checks every call.

### Route protection

Global guard = every route protected by default. `@Public()` on `/health` (and
`/auth/login`); `@AuthOnly()` on `/auth/me`, `/auth/logout`,
`/auth/switch-tenant`. `/health` never requires a session or tenant (task 11).
The read-only `/api/v1/admin/{memberships,roles,permissions}` endpoints exist to
exercise the guard + RLS end to end — they are platform-security administration,
not business UI.

## Consequences

- Adding a permission = editing `PERMISSION_DEFINITIONS` + re-running `db:seed`
  (a reviewed change; a `permissions.test.ts` locks the catalogue shape).
- Scope-aware assignment (`branch` / `department` / `team` / `self` from ADR 0011) remains deferred to ADR 0026's plan; every assignment is tenant-scoped.
- The `TENANT_ADMIN` provisioning hook is ready for a future tenant-creation
  flow; there is no tenant-creation endpoint in this task.
