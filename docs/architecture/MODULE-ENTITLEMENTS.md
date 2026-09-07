# Module Entitlements

_Phase 13A · ADR 0042. See also `PLATFORM-ACCESS.md`, `AUTHORIZATION.md`._

## What a module is

A **module** is a provider-neutral unit of product capability that a platform
administrator enables or disables **per tenant**. The catalogue is **code**, not
a table — `@aivoryx/shared` `MODULE_DEFINITIONS`:

| Key          | Name              | Category   | Depends on                      | Permission prefixes (owned)                                                                                          |
| ------------ | ----------------- | ---------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CRM`        | CRM               | sales      | —                               | `crm`, `customers`                                                                                                   |
| `FIELD`      | Field Operations  | operations | —                               | `field`                                                                                                              |
| `SUPPLY`     | Supply Chain      | operations | —                               | `projects.read/create/update/approve`, `products`, `suppliers`, `warehouses`, `inventory`, `procurement`, `dispatch` |
| `COMMERCIAL` | Quotations        | sales      | `CRM`, `SUPPLY`                 | `quotations`                                                                                                         |
| `EPC`        | Project Execution | operations | `COMMERCIAL`, `SUPPLY`, `FIELD` | `projects.execution/installation/qc/net_metering/handover/complete/defects`                                          |
| `FINANCE`    | Finance           | finance    | —                               | `finance`                                                                                                            |
| `HR`         | HR & Workforce    | people     | —                               | `hr`                                                                                                                 |

`moduleForPermission(key)` resolves a permission to its module by exact-match or
`prefix + '.'`; platform / identity permissions (`users.*`, `roles.*`,
`tenants.*`, `permissions.read`, `memberships.*`, `settings.*`, `notifications.*`,
`audit.read`, `access.read`, `platform.*`) resolve to `null` and are **always
available**. The map is memoized.

## Storage

`tenant_module_entitlements` (migration 0015) — tenant-owned:

| Column                       | Notes                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| `id`                         | UUIDv7                                                                   |
| `tenant_id`                  | FK → `tenants`, `on delete cascade`                                      |
| `module_key`                 | stable key from the code catalogue                                       |
| `state`                      | `module_entitlement_state`: `ENABLED` \| `DISABLED` (default `DISABLED`) |
| `enabled_at` / `disabled_at` | set on the corresponding transition                                      |
| `provisioned_by_user_id`     | the platform-admin user that last changed it                             |
| `note`                       | free text                                                                |
| unique                       | `(tenant_id, module_key)`                                                |

**RLS** — ENABLE + FORCE; `GRANT SELECT, INSERT, UPDATE, DELETE` to
`aivoryx_app`; `tenant_module_entitlements_tenant_isolation`
(`tenant_id = app.tenant_id`); additive
`tenant_module_entitlements_platform_read` **FOR SELECT** gated on a
`platform_admins` row for `app.user_id`.

> The additive platform-read policy is **not** tenant-scoped by design (a
> platform admin lists every workspace). `EntitlementService` therefore filters
> by `tenant_id` **in the query**, never relying on RLS alone (CLAUDE.md §5).

## `EntitlementService` — the single source of truth

`apps/api/src/entitlements/entitlement.service.ts`. Depends only on
`@aivoryx/db`, `@aivoryx/shared`, `AuditService` — never a business module.

| Method                                                                 | Purpose                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `getEnabledModules(scope)`                                             | `Set<ModuleKey>` — used by `SecurityGuard`, `AccessService`, `/auth/me`   |
| `hasModule(scope, key)` / `requireModule(scope, key)`                  | boolean / throw `ENTITLEMENT_MODULE_NOT_ENABLED`                          |
| `listForTenant(scope)`                                                 | every catalogue module + its state (DISABLED where no row)                |
| `setEntitlement({ platformUserId, tenantId, moduleKey, state, note })` | dependency-checked write, in the **target tenant's** RLS context, audited |

### Dependency rules

- **Enable** `M`: every module in `getModule(M).dependencies` must already be
  `ENABLED`, else `422 ENTITLEMENT_DEPENDENCY_UNMET`
  (`details.missing = [<keys>]`).
- **Disable** `M`: no `ENABLED` module may still depend on `M`, else
  `422 ENTITLEMENT_DEPENDANT_ENABLED` (`details.dependants = [<keys>]`).
- Rejection, never cascade. The platform admin disables top-down.

Enable/disable is idempotent (`insert … on conflict do update`); the unique
constraint plus `READ COMMITTED` serialization means concurrent writes to the
same `(tenant, module)` converge to one row with no lost-update and no 5xx.

## Provisioning

- `packages/db/src/seed.ts` `provisionModuleEntitlements(handle, { tenantId,
actingUserId, moduleKeys?, provisionedByUserId? })` — upserts `ENABLED` rows;
  `moduleKeys` defaults to the full catalogue.
- `provisionTenantAdmin(…, { moduleKeys? })` calls it first, so every seeded
  workspace is entitled to exactly the modules the caller names (full catalogue
  by default — keeps the pre-Phase-13 suites green).
- `pnpm --filter @aivoryx/api run seed:platform-demo` — Company A
  (`northwind-demo`, all 7) and Company B (`southbridge-demo`, `CRM` + `SUPPLY`
  only) plus a global platform admin. Deterministic, rerunnable.

## API

| Method & path                                               | Guard              | Notes                                         |
| ----------------------------------------------------------- | ------------------ | --------------------------------------------- |
| `GET /api/v1/platform/overview`                             | `@PlatformAdmin()` | counts + catalogue                            |
| `GET /api/v1/platform/modules`                              | `@PlatformAdmin()` | catalogue                                     |
| `GET /api/v1/platform/tenants`                              | `@PlatformAdmin()` | all workspaces + counts                       |
| `GET /api/v1/platform/tenants/:tenantId[/modules]`          | `@PlatformAdmin()` | one workspace + entitlements                  |
| `PUT /api/v1/platform/tenants/:tenantId/modules/:moduleKey` | `@PlatformAdmin()` | `{ state, note? }`; dependency-checked; `200` |

Errors: `ENTITLEMENT_UNKNOWN_MODULE` (404), `ENTITLEMENT_DEPENDENCY_UNMET` /
`ENTITLEMENT_DEPENDANT_ENABLED` (422), `PLATFORM_TENANT_NOT_FOUND` (404),
`PLATFORM_ADMIN_REQUIRED` (403).

## Effect on authorization

`SecurityGuard` resolves `ctx.entitledModules` once per request (from
`EntitlementService.getEnabledModules`) and denies with
`ENTITLEMENT_MODULE_NOT_ENABLED` **before** the permission check for any route
whose required permission maps to a non-entitled module, or any `@RequireModule`
route. Disabling a module takes effect on the tenant's very next request — there
is no entitlement cache.
