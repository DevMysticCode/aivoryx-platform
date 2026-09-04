# Authentication and Authorization Architecture

Status: **Implemented** in Phase 2 Task 2 (ADR 0027 / 0028 / 0029). Sections
marked _(planned)_ below are not yet built.

Covers decisions 8 and 9.

## Implemented in Phase 2 Task 2

- Endpoints: `POST /api/v1/auth/login` (public), `POST /api/v1/auth/logout`,
  `GET /api/v1/auth/me`, `POST /api/v1/auth/switch-tenant` (all session-auth).
- `SessionService` (create / resolve / revoke / touch `last_seen_at` /
  `setActiveMembership`), `PasswordService` (Argon2id via `@node-rs/argon2`,
  `needsRehash`), `RbacService` (permissions per active membership).
- Global `SecurityGuard` (`APP_GUARD`): `@Public()` / `@AuthOnly()` /
  `@RequirePermission(key)`; `@Security()` etc. param decorators;
  `SecurityContext` in `req` + AsyncLocalStorage.
- Tenant context via `@aivoryx/db` `withTenantContext` + PostgreSQL RLS
  (ADR 0027) — the `aivoryx_app` role, `SET LOCAL app.tenant_id` / `app.user_id`.
- Permission catalogue + `TENANT_ADMIN` role: `@aivoryx/shared`
  `PERMISSION_DEFINITIONS`, seeded by `pnpm db:seed` / `provisionTenantAdmin`.
- Error codes: `AUTH_UNAUTHENTICATED`, `AUTH_INVALID_CREDENTIALS`,
  `AUTH_SESSION_EXPIRED`, `AUTH_SESSION_REVOKED`, `AUTH_FORBIDDEN`,
  `AUTH_NO_ACTIVE_TENANT`, `AUTH_MEMBERSHIP_INVALID`,
  `AUTH_MEMBERSHIP_SUSPENDED`, `TENANT_SUSPENDED`.

Detail: **ADR 0027** (RLS runtime role + tenant transactions), **ADR 0028**
(session lifecycle + login tenant auto-selection), **ADR 0029** (RBAC
enforcement + permission catalogue).

## Authentication - cookie-based server sessions

- Login: email + password. Passwords hashed with **Argon2id**
  (per-hash salt; tuned memory/time/parallelism recorded in config; rehash on
  login when parameters change).
- On success the API creates a **server-side session** record and sets a
  session cookie: `HttpOnly`, `Path=/`, `SameSite` from config (default `Lax`),
  `Secure` (on outside `development`), `Max-Age` = absolute TTL. The cookie
  carries a 256-bit opaque random token; the database stores only its
  **SHA-256 hash** (`sessions.token_hash`). Absolute + idle expiry and revocation
  are enforced server-side on every request (`SessionService.resolve`).
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
  `X-Tenant-Id` header or a body/query field. Set on `login` (auto-selected iff
  the user has exactly one usable membership) and changed via
  `POST /auth/switch-tenant` (ADR 0026 / 0028).
- **Redis is not a session store.** Correctness must not depend on Redis: an
  optional read-through cache for session lookups may be added later, but it
  must always fall back to Postgres and a Redis outage must not affect
  authentication, authorization or revocation. Not implemented in the initial
  Phase 2 build (see open decisions).
- No JWT for browser auth. No token in `localStorage`. `logout` sets
  `revoked_at`; a revoked or expired session is rejected on the next request.
- Unknown user and wrong password return the **same** 401
  `AUTH_INVALID_CREDENTIALS` (no account enumeration); `login` always runs an
  Argon2id verify (against a dummy hash when the email is unknown) to flatten
  timing.
- CSRF _(baseline implemented, token planned)_: `SameSite` cookie + CORS
  allow-list + credentials. A double-submit CSRF token on state-changing
  requests is a follow-up.
- Brute force _(planned)_: per-account + per-IP rate limiting and lockout.
- Password reset _(planned)_: single-use, short-TTL email token; reset revokes
  all sessions (`SessionService.revokeAllForUser` exists).
- MFA (TOTP) _(planned)_ — the `users` / `sessions` model reserves room.
- Service-to-service auth _(planned)_ uses a separate signed credential, never a
  user session.

## Authorization - scope-aware RBAC

### Concepts

- **Permission**: a stable string `<resource>.<action>` from the catalogue in
  `@aivoryx/shared` (`PERMISSION_DEFINITIONS`). Initial set is identity/admin
  only (`users.*`, `memberships.*`, `roles.*`, `permissions.read`, `tenants.*`);
  CRM/HR permissions are added by their modules later.
- **Role**: a tenant-scoped bundle of permissions. The only generic platform
  role is **`TENANT_ADMIN`** (the full catalogue), seeded per tenant by
  `provisionTenantAdmin`. No business roles in the platform core.
- **Scope**: `tenant | branch | department | team | self`. **Deferred**
  (ADR 0026): no scope column yet; every assignment is `tenant`-scoped.
- **Assignment**: `membership_roles(membership_id, role_id)` (ADR 0026).
  `roles` per tenant, `permissions` global; `role_permissions` links them.

### Decision function

Per request the guard resolves the permission set for the session's **active
membership** (`membership_roles ⋈ role_permissions ⋈ permissions`, read inside
`withTenantContext` so RLS scopes it to the active tenant). `can =
permissions.has(key)`. A role or grant from another tenant is invisible and
cannot authorize. Deny → `AUTH_FORBIDDEN` (403) + correlation id + the missing
permission key in `details`.

### Enforcement points

- **API**: `@RequirePermission('roles.read')` on a controller action;
  `SecurityGuard` (global `APP_GUARD`) checks it after resolving the tenant. It
  distinguishes **401** (unauthenticated) from **403** (authenticated, not
  authorized). Scope filter injection is _(planned)_ with the scope model.
- **Data layer**: tenant filter is enforced by RLS (ADR 0027); an explicit
  `tenant_id` filter in queries is belt-and-braces.
- **Frontend** _(planned)_: `lib/permissions` mirrors the catalogue for
  show/hide only; the server re-checks every call.

### Catalogue governance

`PERMISSION_DEFINITIONS` in `@aivoryx/shared` is the single source of truth.
`permissions` rows are seeded from it (`pnpm db:seed`). Adding a permission is a
reviewed change; controllers reference `PermissionKey`, not literals.

## Relationship to tenancy

Authorization runs **after** tenant resolution (`TENANCY.md`). Tenant isolation
is not a permission - it is always enforced. RBAC scopes narrow access _within_
the already-tenant-scoped set.

## Audit _(planned)_

Login/logout, session revoke, role grant/revoke, permission-denied on sensitive
actions, and all privileged operations will write to `audit_logs` (append-only).
For now these events are structured-logged with the correlation id, user id and
tenant id (ADR 0014). The `audit_logs` table lands with the audit module.
