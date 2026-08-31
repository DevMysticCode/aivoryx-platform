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
