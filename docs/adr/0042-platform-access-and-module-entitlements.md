# ADR 0042 — Platform Access, Module Entitlements & Effective Authorization

Status: Accepted (Phase 13A — the platform-access foundation: a module
catalogue, per-tenant module entitlements, a global platform-admin identity, and
an entitlement-aware extension of the existing RBAC into Profiles / Permission
Sets / Data Scopes)

Builds on ADR 0001 (modular monolith — still holds), ADR 0007 (Drizzle),
ADR 0008 (UUIDv7), ADR 0009 / 0027 (multi-tenancy & RLS), ADR 0011 / 0026 /
0029 (scope-aware RBAC, identity/membership model, permission catalogue &
enforcement), ADR 0030 (tenant administration), ADR 0040 (global audit log).

It adds **no** billing / metering / Stripe, **no** microservices or separately
deployed apps, **no** SSO / SAML / OIDC / SCIM, **no** MFA, **no** ABAC / policy
engine, **no** second identity system, and **no** second authorization model.

## Context

Aivoryx is one product with many capability areas. Different tenants buy
different subsets. Before Phase 13 every authenticated tenant member could reach
every module's API if their role carried the permission — there was no concept
of "this workspace does not have Finance". The RBAC catalogue (ADR 0029) is
flat: 148 global permission keys, per-tenant `roles` / `role_permissions` /
`membership_roles`, resolved by `SecurityGuard`.

Phase 13 must add a product-access layer **above** RBAC without inverting or
duplicating it. The authorization order is fixed and must never be reordered:

```
TENANT MODULE ENTITLEMENT → USER PROFILE / PERMISSION SET → DATA SCOPE → ALLOW / DENY
```

A user can never reach a module the tenant is not entitled to, regardless of the
permissions their profile or permission sets carry. Hiding navigation is not
sufficient — every check is server-side and RLS remains the backstop.

## Decision

### 1. The module catalogue is code, not a table

`@aivoryx/shared` `MODULE_DEFINITIONS` is the single authoritative registry of
the seven product modules (`CRM`, `FIELD`, `SUPPLY`, `COMMERCIAL`, `EPC`,
`FINANCE`, `HR`). Each entry carries a stable `key`, display metadata, a
`category`, a nav `order`, its `dependencies`, and the `permissionPrefixes` it
owns. There is nothing tenant-configurable about the catalogue, so a DB table
would only drift. `moduleForPermission(key)` maps every business permission to
exactly one module (memoized); platform / identity permissions map to `null` and
are always available.

Module dependencies (enforced on enable/disable):

| Module                          | Depends on                |
| ------------------------------- | ------------------------- |
| CRM, FIELD, SUPPLY, FINANCE, HR | —                         |
| COMMERCIAL                      | CRM, SUPPLY               |
| EPC                             | COMMERCIAL, SUPPLY, FIELD |

### 2. `tenant_module_entitlements` — the entitlement boundary

A tenant-owned table (migration 0015): one row per `(tenant_id, module_key)`
with `state ENABLED | DISABLED`, enable/disable timestamps, and the
`provisioned_by_user_id`. ENABLE + FORCE RLS, full DML grant to `aivoryx_app`,
`tenant_id = app.tenant_id` isolation policy, plus an **additive
`*_platform_read` SELECT policy** (migration 0017) gated on a `platform_admins`
row so a platform admin can read every workspace's entitlements without an owner
connection. Writes are never reachable that way — only through
`EntitlementService.setEntitlement`, which enters the **target tenant's** RLS
context.

`EntitlementService` is the single answer to "does this tenant have this
module?". It scopes every read by `tenant_id` **in the query** — RLS is the
backstop, not the only guard (CLAUDE.md §5), because the additive platform-read
policy is deliberately not tenant-scoped.

### 3. `platform_admins` — a global identity, not a membership

A global table (migration 0015): `user_id` unique, `granted_by_user_id`, `note`.
A row grants Aivoryx **platform administration** — managing workspaces and their
module entitlements — and nothing tenant-side. A platform admin is **not**
automatically a tenant business user and never needs a membership to operate
`/platform/*`. RLS: ENABLE + FORCE, `SELECT`-only grant to `aivoryx_app`, a
`platform_admins_self_read` policy (`user_id = app.user_id`) so
`PlatformAdminService.isPlatformAdmin` can resolve with only `app.user_id` bound.
Grant/revoke is a deployment operation (seed / migration), not a runtime API in
Phase 13A.

### 4. Extend RBAC — do not add a second model

`roles.kind` (`profile | permission_set | custom`, migration 0015) and
`membership_roles.data_scope` (`OWN | TEAM | DEPARTMENT | COMPANY`) are the only
new authorization columns.

- **Profile** — a `roles` row with `kind = 'profile'`: a member's single
  baseline capability set. Assigned with a data scope.
- **Permission Set** — a `roles` row with `kind = 'permission_set'`: additive,
  zero-or-more per member.
- **Role** — the existing RBAC abstraction; `kind = 'custom'` covers
  `TENANT_ADMIN`, `FIELD_AGENT` and any hand-made role. Unchanged.
- **Data Scope** — a per-assignment column on `membership_roles`. Phase 13A
  **stores and reports** it and exposes it in effective access; it does not
  retrofit row-level scope filtering into modules that do not already implement
  it (see Limitations).

`AccessService` may only put a permission into a profile / permission set if its
module is entitled (or it is a platform permission) — otherwise
`ACCESS_PERMISSION_NOT_AVAILABLE`. Effective access always intersects a member's
granted permissions with the tenant's entitled modules, so entitlement precedes
permission everywhere.

### 5. `SecurityGuard` — entitlement before permission, one gate

Order of failure (unchanged prefix, two new steps):

```
401 AUTH_UNAUTHENTICATED
401 AUTH_SESSION_REVOKED | EXPIRED
403 AUTH_NO_ACTIVE_TENANT
403 AUTH_MEMBERSHIP_SUSPENDED | TENANT_SUSPENDED
403 PLATFORM_ADMIN_REQUIRED        ← @PlatformAdmin() routes, tenant-less
403 ENTITLEMENT_MODULE_NOT_ENABLED ← moduleForPermission(required) or @RequireModule()
403 AUTH_FORBIDDEN                  ← the permission itself
```

The entitlement step runs for **every** existing `@RequirePermission` route with
zero per-controller changes: the guard computes `moduleForPermission(required)`
and checks `ctx.entitledModules` before the permission check. `@RequireModule()`
gates the rare route with no specific permission. `ENTITLEMENT_MODULE_NOT_ENABLED`
is a distinct code from `AUTH_FORBIDDEN`, so a disabled module and a missing
permission are never confused.

### 6. `/platform/*` and `/admin/access` API families

- `GET /platform/overview | modules | tenants | tenants/:tenantId[/modules]`,
  `PUT /platform/tenants/:tenantId/modules/:moduleKey` — all `@PlatformAdmin()`.
  The `:tenantId` is a **selection** the platform admin makes, never their
  identity: it is never used to set an active tenant or to widen RLS beyond the
  established platform-read policy.
- `GET/POST/PATCH/DELETE /admin/profiles` and `/admin/permission-sets`
  (`roles.*`), `GET /admin/access/available-permissions` (`roles.read`),
  `GET /admin/access/:membershipId` (`access.read`),
  `POST /admin/access/:membershipId/profile` and `/permission-sets`,
  `DELETE …/permission-sets/:roleId` (`memberships.update`).

Four new permissions: `access.read`, `platform.tenants.read`,
`platform.tenants.manage`, `platform.modules.provision` (148 total).

### 7. Audit

`AuditService` (ADR 0040) records `platform.module.enabled` / `.disabled`
(module `platform`, `SYSTEM` actor, `source: platform-admin`) under the target
tenant, and `identity.role.created|updated|deleted`,
`tenant.member.profile_assigned`, `tenant.member.role_added|removed` for access
configuration. No secrets, tokens, or bank/financial data.

## Consequences

- Every module API is entitlement-gated with no code churn in the modules.
- The frontend consumes `entitledModules` + effective `permissions` from
  `/auth/me` and never invents its own authorization.
- One authorization model. `roles.kind` keeps Profiles / Permission Sets inside
  the audited, RLS-scoped `roles` machinery.
- A defect found during hardening: `EntitlementService` read entitlements
  through RLS alone, and the additive platform-read policy let a platform-admin
  actor see every tenant's rows. Fixed by an explicit `tenant_id` predicate in
  the query.

## Limitations (carried to later phases)

- **Data scope is stored and reported, not universally enforced.** Modules that
  already implement OWN/assigned filtering (Field visits, HR self-service) keep
  doing so; `DEPARTMENT` / `TEAM` are not retrofitted into modules that have no
  team/department concept. No sharing engine.
- Platform-admin grant/revoke is seed/migration only — no runtime API yet.
- No billing, SSO, MFA, ABAC, dashboard builder (explicitly out of scope, §58).
- Phase 13B (product experience — shell, navigation registry, CRM flagship,
  `/platform` and `/admin/access` UIs) is **not** part of this ADR.
