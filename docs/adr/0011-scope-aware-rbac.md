# ADR 0011 — Scope-Aware RBAC

Status: Accepted

## Context

Roles alone (telecaller, field agent, manager) are not enough: a telecaller must
see only their leads, a branch manager only their branch. Row visibility is part
of authorization, not an afterthought.

## Decision

RBAC with an explicit **scope** dimension.

- **Permission**: stable string `<module>.<resource>.<action>`.
- **Role**: tenant-defined bundle of permissions (seeded defaults provided).
- **Scope**: `tenant | branch | department | team | self`.
- **Assignment**: `user_roles(user_id, role_id, scope_type, scope_id)` — a role
  held at a particular scope.
- `can(user, permission, target)` allows if any of the user's roles grants the
  permission at a scope that contains the target.
- API: `@RequirePermission(...)` guard on every action; the guard also injects a
  scope filter the data layer applies **in addition to** `tenant_id`.
- Frontend permission checks are cosmetic; the server re-checks every action.
- The permission catalogue lives in `packages/shared`; controllers reference
  constants, not literals.

## Consequences

One decision function, uniformly enforced. Adding a permission is a reviewed
change. Detail in `docs/architecture/AUTH.md`.

## Refinement (ADR 0026)

The persistent model in Phase 2 Task 1 replaces `user_roles(user_id, role_id,
…)` with **`membership_roles(membership_id, role_id)`** — roles attach to a
`user_tenant_memberships` row, i.e. per `(user, tenant)`. `roles` are per-tenant
(`tenant_id NOT NULL`); `permissions` are a global catalogue. The `scope_type` /
`scope_id` dimension is **deferred** until `branch` / `department` / `team`
entities exist; every assignment is currently at `tenant` scope and scope
columns are added later by migration.

## Implementation (ADR 0029)

Phase 2 Task 2 implements enforcement: the `PERMISSION_DEFINITIONS` catalogue in
`@aivoryx/shared` (identity/admin keys only), the generic `TENANT_ADMIN` role
(seeded per tenant), `@RequirePermission(key)` + the global `SecurityGuard`
(401 vs 403 kept distinct), and permission resolution per **active membership**
inside `withTenantContext` so a grant from another tenant cannot authorize.
