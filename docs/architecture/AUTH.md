# Authentication and Authorization Architecture

Status: Approved architecture. No application code exists yet.

Covers decisions 8 and 9.

## Authentication - cookie-based server sessions

- Login: email + password. Passwords hashed with **Argon2id**
  (per-hash salt; tuned memory/time/parallelism recorded in config; rehash on
  login when parameters change).
- On success the API creates a **server-side session** record and sets a
  session cookie:
  `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` for the admin surface),
  `Path=/`, host-only, short idle lifetime + absolute lifetime, rotating id on
  privilege change. The cookie carries an opaque random token; the database
  stores only its **SHA-256 hash** (`sessions.token_hash`).
- Session store: **PostgreSQL is authoritative.** Table `sessions` (id, user_id,
  token_hash, active_membership_id, created_at, last_seen_at, expires_at,
  revoked_at, ip, user_agent) is the single source of truth for session
  existence, expiry and revocation.
- **Active tenant:** a session operates against at most one tenant at a time,
  held in `sessions.active_membership_id` → `user_tenant_memberships.id`
  (nullable — none selected yet). A composite FK
  `sessions(user_id, active_membership_id) → user_tenant_memberships(user_id, id)`
  guarantees the membership belongs to the session's own user. This column,
  resolved server-side, is the authoritative tenant selector — **never** an
  `X-Tenant-Id` header or a body/query field. The endpoint that sets/switches it
  is a later task (ADR 0026).
- **Redis is not a session store.** Correctness must not depend on Redis: an
  optional read-through cache for session lookups may be added later, but it
  must always fall back to Postgres and a Redis outage must not affect
  authentication, authorization or revocation. Not implemented in the initial
  Phase 2 build (see open decisions).
- No JWT for browser auth. No token in `localStorage`. Logout and admin
  "revoke session" delete the server record immediately.
- CSRF: `SameSite` cookie + a double-submit CSRF token on state-changing
  requests; `/api/v1` rejects cross-origin credentialed requests not on the
  allow-list.
- Brute force: per-account + per-IP rate limiting and lockout with backoff;
  auth events (success, failure, lockout, reset) are audit-logged.
- Password reset: single-use, short-TTL token delivered by email; reset revokes
  all existing sessions.
- MFA (TOTP) is **not** in V1 but the `users` / `sessions` model reserves room
  for it (see open decisions).
- Service-to-service (worker -> API, if ever needed) uses a separate signed
  service credential, never a user session.

## Authorization - scope-aware RBAC

### Concepts

- **Permission**: a stable string, `<module>.<resource>.<action>`
  (e.g. `crm.lead.read`, `crm.lead.assign`, `hr.leave.approve`).
- **Role**: a named bundle of permissions, tenant-defined (seeded defaults:
  `owner`, `admin`, `sales_manager`, `telecaller`, `field_agent`, `hr_manager`,
  `employee`).
- **Scope**: the data boundary a grant applies within -
  `tenant` | `branch` | `department` | `team` | `self`. **Deferred** (ADR 0026):
  the current model has no scope column and every assignment is `tenant`-scoped
  until `branch` / `department` / `team` entities exist.
- **Assignment**: `membership_roles(membership_id, role_id)` - a role is attached
  to a `user_tenant_memberships` row, i.e. held by a user within one tenant
  (ADR 0026, replacing the earlier `user_roles`). `roles` are per-tenant;
  `permissions` are a global catalogue.

### Decision function

`can(user, permission, target) =>`

1. collect the user's roles whose permission set includes `permission`;
2. for each, check the grant's scope contains `target` (self ⊂ team ⊂
   department ⊂ branch ⊂ tenant);
3. allow if any grant matches; otherwise deny with `AUTH_FORBIDDEN` +
   correlation id.

### Enforcement points

- **API**: a `@RequirePermission('crm.lead.read')` guard on every controller
  action; the guard also injects a **scope filter** (e.g. `branch_id IN (...)`,
  `assigned_user_id = self`) that the data layer must apply in addition to
  `tenant_id`.
- **Data layer**: scope filter + tenant filter are both mandatory for
  scoped resources; missing either is a hard error.
- **Frontend**: `lib/permissions` mirrors the permission catalogue for
  show/hide/disable only - never as the security boundary. All checks are
  re-evaluated server-side.

### Catalogue governance

The permission string catalogue lives in `packages/shared` (planned) and is the
single source of truth. Adding a permission is a reviewed change; controllers
reference catalogue constants, not literals.

## Relationship to tenancy

Authorization runs **after** tenant resolution (`TENANCY.md`). Tenant isolation
is not a permission - it is always enforced. RBAC scopes narrow access _within_
the already-tenant-scoped set.

## Audit

Login/logout, session revoke, role grant/revoke, permission-denied on sensitive
actions, and all privileged operations write to `audit_logs` (append-only).
