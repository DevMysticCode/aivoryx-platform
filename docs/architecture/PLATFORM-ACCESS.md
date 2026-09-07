# Platform Access

_Phase 13A · ADR 0042. See also `MODULE-ENTITLEMENTS.md`, `AUTHORIZATION.md`,
`AUTH.md`, `TENANCY.md`._

Aivoryx is one product. This document describes the layer **above** a tenant:
who administers the platform, and how a workspace's product surface is
provisioned.

## Platform Admin vs Tenant Admin

|                     | Platform Admin                                        | Tenant Admin                                                                                |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Identity            | a row in the global `platform_admins` table           | the `TENANT_ADMIN` role (`roles.key`) in one tenant                                         |
| Scope               | above every tenant                                    | one workspace                                                                               |
| Needs a membership? | **no** — operates `/platform/*` tenant-less           | yes                                                                                         |
| Can                 | list workspaces, enable/disable modules per workspace | manage members, roles, profiles, permission sets, branding, audit — within entitled modules |
| Cannot              | touch tenant business data through `/platform/*`      | reach any `/platform/*` route (→ `PLATFORM_ADMIN_REQUIRED`)                                 |
| Granted by          | seed / migration (no runtime API in 13A)              | another tenant admin (`memberships.update`)                                                 |

A platform admin who _also_ wants to use a workspace gets a normal membership +
profile there; the two identities are independent and neither implies the other.

## `platform_admins`

Global table (migration 0015): `user_id` (unique, FK → `users`
`on delete cascade`), `granted_by_user_id` (FK → `users` `on delete set null`),
`note`, timestamps.

**RLS** — ENABLE + FORCE; `REVOKE INSERT, UPDATE, DELETE` and `GRANT SELECT` to
`aivoryx_app`; `platform_admins_self_read` policy
(`user_id = app.user_id`). So the table is:

- **read-only** to the application role — grant/revoke is a privileged
  (owner / migration / seed) operation;
- **self-scoped** — `PlatformAdminService.isPlatformAdmin(userId)` resolves with
  only `app.user_id` bound and can only ever see the caller's own row.

`PlatformAdminService` caches the boolean for 30 s per user (`invalidate(userId)`
on change).

## The `@PlatformAdmin()` boundary

`SecurityGuard` resolves `ctx.isPlatformAdmin` for **every** request (user-scoped,
tenant-independent). A `@PlatformAdmin()` route:

- requires an authenticated session and `ctx.isPlatformAdmin === true`, else
  `403 PLATFORM_ADMIN_REQUIRED`;
- does **not** require an active tenant (`strictTenant` is false);
- is never reachable by an ordinary tenant user, no matter what permissions
  their profile carries — a tenant user with `platform.modules.provision` in
  their role still gets `PLATFORM_ADMIN_REQUIRED`.

The platform-admin decision is derived **only** from the authenticated
server-side identity. It cannot be influenced by an `X-Tenant-Id` header, a URL
tenant id, a query parameter, a request body field, or a DTO — the guard reads
none of those for this decision. Verified by negative tests in
`apps/api/test/platform.int.spec.ts`.

## The `:tenantId` route parameter

Routes such as `PUT /platform/tenants/:tenantId/modules/:moduleKey` take a target
tenant id **as a legitimate selection** — the platform admin is explicitly
choosing which workspace to provision. The guarantees:

- it is **never** used to set the caller's active tenant;
- it is **never** used to widen RLS beyond the established additive
  `*_platform_read` SELECT policies;
- entitlement **writes** re-enter the target tenant's own RLS context
  (`withTenantContext({ tenantId, userId: platformUserId })`) via
  `EntitlementService.setEntitlement` — never an owner connection, never a
  client-supplied tenant trusted for a write path;
- a `PUT` against workspace B leaves the platform admin with zero memberships
  and no active tenant (`/auth/me` unchanged).

## Cross-workspace reads

`PlatformService.listTenants` / `getTenant` run with only `app.user_id` bound
(`withUserContext`). The additive `tenants_platform_read`, `utm_platform_read`
and `tenant_module_entitlements_platform_read` SELECT policies (migration 0017),
each gated on a `platform_admins` row, let a platform admin read workspace,
membership-count and entitlement data across tenants **without** an owner
connection and **without** any write capability. Ordinary tenant users are
unaffected — those policies are `EXISTS (… platform_admins …)` and evaluate
false for them.

## What Phase 13A deliberately does not build

Billing / metering / Stripe · microservices or separate apps · SSO / SAML / OIDC
/ SCIM · MFA · a runtime platform-admin grant API · a dashboard builder · an
ABAC / policy engine. The frontend product experience (application shell,
navigation registry, CRM flagship, the `/platform` and `/admin/access` UIs) is
**Phase 13B**.
