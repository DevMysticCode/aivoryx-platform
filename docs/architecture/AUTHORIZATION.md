# Authorization

_Phase 13A · ADR 0042. Extends `AUTH.md` (ADR 0029 RBAC) and `TENANCY.md`
(ADR 0027 RLS). See also `MODULE-ENTITLEMENTS.md`, `PLATFORM-ACCESS.md`._

## The fixed order

Every protected request is decided in this order. It is never reordered and
there is no second model:

```
   identity            who is the authenticated user?              (session cookie → SessionService)
      ↓
   tenant context      which membership is active?                 (SecurityGuard → withTenantContext)
      ↓
   platform / tenant    is this a @PlatformAdmin() route?           (platform_admins row)
   boundary
      ↓
   module entitlement   does the tenant have this module?           (tenant_module_entitlements)
      ↓
   permission           does the profile / permission sets grant    (roles + role_permissions +
                        the required key?                            membership_roles)
      ↓
   data scope           OWN / TEAM / DEPARTMENT / COMPANY            (membership_roles.data_scope)
      ↓
   RLS                  PostgreSQL Row-Level Security                 (aivoryx_app, app.tenant_id)
```

## Vocabulary

| Term                   | Definition                                                                                            | Storage                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Module catalogue**   | the authoritative registry of the 7 product modules, their dependencies and owned permission prefixes | code — `@aivoryx/shared` `MODULE_DEFINITIONS`                       |
| **Tenant entitlement** | whether a workspace may use a module                                                                  | `tenant_module_entitlements` (`ENABLED`/`DISABLED`)                 |
| **Profile**            | a member's single baseline capability set, assigned with a data scope                                 | `roles` (`kind = 'profile'`) + `membership_roles`                   |
| **Permission set**     | an additive capability set; zero-or-more per member                                                   | `roles` (`kind = 'permission_set'`) + `membership_roles`            |
| **Role**               | the existing RBAC abstraction; `TENANT_ADMIN`, `FIELD_AGENT`, custom                                  | `roles` (`kind = 'custom'`)                                         |
| **Permission**         | one of 148 global keys (ADR 0029)                                                                     | `permissions` (global) + `role_permissions` (per-tenant)            |
| **Data scope**         | the access boundary for an assignment                                                                 | `membership_roles.data_scope` (`OWN`/`TEAM`/`DEPARTMENT`/`COMPANY`) |
| **Effective access**   | `tenant entitlement ∩ (profile ∪ permission sets)` + applicable scope                                 | computed by `AccessService.effectiveAccess`                         |
| **Platform admin**     | global Aivoryx administration; not a membership                                                       | `platform_admins` (global)                                          |
| **Tenant admin**       | tenant-scoped administration                                                                          | `roles.key = 'TENANT_ADMIN'`                                        |

## Which layer enforces what

| Layer                | Enforced by                                                                                                                                           | Failure code                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| identity             | `SecurityGuard` + `SessionService` (cookie)                                                                                                           | `AUTH_UNAUTHENTICATED`, `AUTH_SESSION_REVOKED/EXPIRED`                                 |
| tenant context       | `SecurityGuard` → `AuthService.resolveActiveTenant` → `withTenantContext`                                                                             | `AUTH_NO_ACTIVE_TENANT`, `AUTH_MEMBERSHIP_SUSPENDED`, `TENANT_SUSPENDED`               |
| platform boundary    | `SecurityGuard` + `PlatformAdminService.isPlatformAdmin` (`@PlatformAdmin()`)                                                                         | `PLATFORM_ADMIN_REQUIRED`                                                              |
| module entitlement   | `SecurityGuard` + `EntitlementService.getEnabledModules`, via `moduleForPermission(required)` or `@RequireModule()` — **before** the permission check | `ENTITLEMENT_MODULE_NOT_ENABLED`                                                       |
| permission           | `SecurityGuard` — `ctx.permissions.has(required)`                                                                                                     | `AUTH_FORBIDDEN`                                                                       |
| access configuration | `AccessService` — a profile/set may only hold entitled-module permissions                                                                             | `ACCESS_PERMISSION_NOT_AVAILABLE`, `ACCESS_ROLE_KIND_INVALID`, `ACCESS_PROFILE_IN_USE` |
| data scope           | stored on `membership_roles`; consumed by modules that implement it (Field, HR self-service)                                                          | —                                                                                      |
| RLS                  | PostgreSQL — `aivoryx_app` non-superuser, `FORCE ROW LEVEL SECURITY`, `tenant_id = app.tenant_id`                                                     | rows simply not visible / `42501` on write                                             |

**Entitlement always precedes permission.** A user whose profile carries
`hr.employee.read` in a workspace where HR is disabled is denied with
`ENTITLEMENT_MODULE_NOT_ENABLED`, not `AUTH_FORBIDDEN`. The §50 matrix:

| Tenant has module | User has permission | Result                                 |
| ----------------- | ------------------- | -------------------------------------- |
| yes               | yes                 | **ALLOW** (200)                        |
| yes               | no                  | `AUTH_FORBIDDEN` (403)                 |
| no                | yes                 | `ENTITLEMENT_MODULE_NOT_ENABLED` (403) |
| no                | no                  | `ENTITLEMENT_MODULE_NOT_ENABLED` (403) |

Platform / identity permissions (`moduleForPermission → null`) are **never**
entitlement-gated.

## `SecurityGuard` context

`SecurityContext` carries, per request:

- `user`, `session`, `membership`, `tenantId`
- `permissions: ReadonlySet<string>` — **effective** (raw ∩ entitled modules)
- `entitledModules: ReadonlySet<string>` — the tenant's `ENABLED` module keys
- `isPlatformAdmin: boolean` — resolved for every request, tenant-independent

`/auth/me`, `/auth/login` and `/auth/switch-tenant` return `isPlatformAdmin` and,
in `active`, the effective `permissions` and `entitledModules` for the active
membership. Switching tenant recomputes all three from the newly active
membership — access follows the active membership, never a header. The frontend
consumes these and must not invent its own authorization.

## `AccessService.effectiveAccess`

`GET /api/v1/admin/access/:membershipId` returns, for a member:

- `profile` (`{ id, name, dataScope }` or `null`) and `permissionSets[]`
- `modules[]` — every catalogue module with `entitled`, the member's
  `dataScope` for that module (`null` when not entitled), and every owned
  permission with `granted` (which is `entitled && effective.has(key)` — a
  disabled module never reports a granted permission)
- `platformPermissions[]` — held permissions whose module is `null`

## Where the models meet the database

- **RLS is authoritative** (ADR 0027). `aivoryx_app` is a non-superuser with
  `FORCE ROW LEVEL SECURITY` on every tenant-owned table. `tenant_module_entitlements`
  is tenant-isolated with an additive platform-read SELECT policy;
  `platform_admins` is global, SELECT-only to `aivoryx_app`, self-read.
- **Services still scope explicitly.** `EntitlementService` filters entitlement
  reads by `tenant_id` in the query — the additive platform-read policy is not
  tenant-scoped, so RLS alone would over-read for a platform-admin actor
  (CLAUDE.md §5). RLS is the backstop, not the only guard.
- Negative coverage: `apps/api/test/rls.int.spec.ts` (direct, as `aivoryx_app`)
  and `platform.int.spec.ts` / `access.int.spec.ts` (HTTP).
