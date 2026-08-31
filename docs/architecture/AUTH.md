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
  privilege change.
- Session store: Postgres table `sessions` (id, user_id, tenant_id,
  created_at, last_seen_at, expires_at, ip, user_agent, revoked_at). A Redis
  cache may front it for read latency; Postgres is source of truth.
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
  `tenant` | `branch` | `department` | `team` | `self`.
- **Assignment**: `user_roles(user_id, role_id, scope_type, scope_id)` - a user
  can hold a role at a specific scope (e.g. `sales_manager` for `branch:X`).

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
is not a permission - it is always enforced. RBAC scopes narrow access *within*
the already-tenant-scoped set.

## Audit

Login/logout, session revoke, role grant/revoke, permission-denied on sensitive
actions, and all privileged operations write to `audit_logs` (append-only).
