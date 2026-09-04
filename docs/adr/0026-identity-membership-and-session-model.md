# ADR 0026 — Identity, Membership & Session Data Model

Status: Accepted (Phase 2, Task 1 — technical lead)

Refines ADR 0010 (cookie sessions), ADR 0011 (scope-aware RBAC). Schema only —
no authentication, RLS or RBAC enforcement is implemented by this task.

## Context

Phase 2 needs the persistent identity model that authentication and
authorization build on. The technical lead set one architectural constraint: **a
user may belong to multiple tenants through an explicit membership model**, so a
`tenant_id` column on `users` is not acceptable. ADR 0011's earlier sketch used
`user_roles(user_id, role_id, scope_type, scope_id)`, which predates that
decision.

## Decision

### Shape

```
users ──< user_tenant_memberships >── tenants
                    │
                    └──< membership_roles >── roles ──< role_permissions >── permissions

sessions ──> users
```

Eight tables: `tenants`, `users`, `user_tenant_memberships`, `roles`,
`permissions`, `role_permissions`, `membership_roles`, `sessions`.

### Users are global; the tenant link is always explicit

- `users` is one row per person, with no `tenant_id`. Email is globally unique,
  case-insensitively (a `lower(email)` unique index — no `citext` extension).
- `user_tenant_memberships` is the only representation of "user belongs to
  tenant". Unique on `(user_id, tenant_id)`.
- It also carries `unique(id, tenant_id)` purely as a composite foreign-key
  target (see integrity below).

### Roles are per-tenant; permissions are a global catalogue

- `permissions` is a single platform-wide catalogue of stable
  `<module>.<resource>.<action>` keys (ADR 0011). Not tenant-owned.
- `roles.tenant_id` is `NOT NULL` — every role belongs to a tenant. Platform
  default roles (e.g. `owner`, `admin`, `member`) are **seeded into each tenant
  by a later task**, not hardcoded, and are generic — never client-specific
  business roles (e.g. no `telecaller` in the platform core). Unique on
  `(tenant_id, key)`.
- `role_permissions` links a tenant role to a catalogue permission.

### Roles attach to the membership, not the user

- `membership_roles(membership_id, role_id, tenant_id)` replaces ADR 0011's
  `user_roles`. A user's roles are always scoped to one membership, i.e. one
  `(user, tenant)` pair.
- **Scope-aware assignment is deferred.** ADR 0011's `scope_type` /
  `scope_id` (branch / department / team / self) is not added now because those
  entities do not exist yet. Every assignment today is effectively at `tenant`
  scope. When scoping entities land, scope columns (or a
  `membership_role_scopes` child table) are added by migration.

### Cross-tenant integrity without triggers

`membership_roles` and `role_permissions` carry a denormalised `tenant_id`, and
their links to `roles` / `user_tenant_memberships` are **composite foreign keys**
on `(…_id, tenant_id)`. This makes it structurally impossible to attach a role
from tenant A to a membership in tenant B — no trigger required. The same
`tenant_id` column is what the later RLS task will key policies on.

### Sessions

- **PostgreSQL is the authoritative session store** (ADR 0010). The cookie
  carries an opaque random token; only its **SHA-256 hash** is stored
  (`sessions.token_hash`, unique), so a database leak yields no usable sessions —
  the same principle as passwords.
- A session belongs to one **user** (`user_id`, FK, cascade) and operates
  against **at most one tenant at a time**, referenced by
  `sessions.active_membership_id` → `user_tenant_memberships.id`. This column —
  never an `X-Tenant-Id` request header — is the authoritative active-tenant
  selector, resolved server-side. It refines `AUTH.md`, which had listed
  `sessions.tenant_id`.
- `active_membership_id` is **nullable**: a session can exist before a tenant is
  selected (pre-login lifecycle, or a just-authenticated user who has not yet
  picked / been defaulted into a tenant).
- **The active membership is guaranteed to belong to the session's own user** by
  a composite foreign key
  `sessions(user_id, active_membership_id) → user_tenant_memberships(user_id, id)`
  (target: a new `unique(user_id, id)` on `user_tenant_memberships`). Under
  PostgreSQL's default `MATCH SIMPLE`, a NULL `active_membership_id` skips the
  check, so this holds without blocking the nullable case — no trigger, no
  reliance on application validation (requirement 9).
- `ON DELETE CASCADE` on that FK: removing a user from a tenant deletes the
  sessions that were active in that membership; the user's sessions active in
  other tenants (or with no active membership) are untouched. `SET NULL` is not
  usable here because it would also null the non-nullable `user_id` half of the
  composite key.
- `expires_at` (absolute) + `revoked_at` support expiry and revocation;
  `last_seen_at` supports idle timeout. Sessions also cascade-delete with the
  user via `sessions.user_id`.
- Still **not** in scope: the endpoint/flow that sets or switches
  `active_membership_id`, default-tenant selection, and any guard that reads it.

### Password storage (fields only)

- `users.password_hash` (nullable `text`) holds a full **Argon2id PHC string**
  (`$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`). Algorithm, parameters and
  per-hash salt are embedded — no separate salt/params column, never plaintext.
- Nullable because a user may exist before a password is set (e.g. invited).
- `password_updated_at` supports rehash-on-parameter-change (ADR 0010).
- No login, verification or hashing code is written by this task.

### Lifecycle status

`tenants.status` (`active|suspended`), `users.status` (`active|disabled`),
`user_tenant_memberships.status` (`active|suspended`) are minimal platform
gating fields that authentication must consult. New values are added by
migration when a flow needs them. No CRM/HR business status here.

### Conventions

- All PKs are UUIDv7 generated in the application (ADR 0008).
- Every entity has `created_at` + `updated_at` (`now()` default; `updated_at`
  also maintained by the ORM `$onUpdate`). Join tables carry `created_at` only.
- Join tables use natural composite primary keys, not surrogate ids.

## Explicitly out of scope for this task

RLS enable/force + policies (ADR 0009), tenant guards, `SET LOCAL app.*`,
login/logout, session issuance/validation, **the endpoint/flow that sets or
switches `active_membership_id`** and default-tenant selection, RBAC enforcement
(`@RequirePermission`), the permission catalogue contents in `packages/shared`,
seed data, invitations, MFA, `organizations` / `branches` / `departments` /
`employees`.

## Consequences

- The membership table is the join point for all tenant-scoped identity: RLS,
  guards and RBAC in later tasks hang off `user_tenant_memberships` and the
  denormalised `tenant_id` on the RBAC join tables.
- A request's tenant is resolved server-side as
  session → `active_membership_id` → `user_tenant_memberships.tenant_id`; a
  guard reading it, and the flow that sets it, come in later tasks.
- `AUTH.md`, `TENANCY.md` and ADR 0011 are updated to point here for the
  assignment and session shapes.

## History

- Phase 2 Task 1 — original eight-table model; sessions referenced a user only.
- Phase 2 Task 1 finalization (technical lead) — added
  `sessions.active_membership_id` with the composite FK
  `(user_id, active_membership_id) → user_tenant_memberships(user_id, id)` so an
  authenticated session operates against exactly one, own-user, tenant
  membership at a time (migration `0002_unique_wallop`).
