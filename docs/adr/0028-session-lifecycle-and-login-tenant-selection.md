# ADR 0028 — Session Lifecycle & Login Tenant Auto-Selection

Status: Accepted (Phase 2, Task 2 — security boundary)

Implements ADR 0010 (cookie sessions + Argon2id) and ADR 0026 (`sessions.active_membership_id`).

## Decision

### Tokens & cookie

- On login the API generates a **256-bit random token** (`crypto.randomBytes(32)`,
  base64url) and stores only its **SHA-256 hash** in `sessions.token_hash`
  (unique). The raw token is returned once, in the `Set-Cookie` header, and
  never appears in a response body or a log (pino redacts `cookie` /
  `set-cookie`).
- Cookie: `HttpOnly`, `Path=/`, `SameSite` from `SESSION_COOKIE_SAMESITE`
  (default `lax`), `Secure` from `SESSION_COOKIE_SECURE` (default: on unless
  `APP_ENV=development`), `Max-Age` = `SESSION_ABSOLUTE_TTL_HOURS`. No JWT, no
  `localStorage`.
- The cookie is **not signed** — a forged token cannot match any stored
  `token_hash`, so signing adds nothing.

### Server-enforced lifecycle

`SessionService.resolve(token)` on every authenticated request:

1. hash the token, look it up joined to `users`;
2. reject if the row is missing → `AUTH_UNAUTHENTICATED`;
3. reject if `revoked_at is not null` → `AUTH_SESSION_REVOKED`;
4. reject if `now >= expires_at` (absolute) → `AUTH_SESSION_EXPIRED`;
5. reject if `now - last_seen_at > SESSION_IDLE_TTL_HOURS` (idle) → `AUTH_SESSION_EXPIRED`;
6. reject if `users.status != 'active'` → `AUTH_UNAUTHENTICATED`;
7. otherwise touch `last_seen_at` — **throttled** to at most once per 60 s to
   avoid a write per request.

Revocation is immediate: `logout` sets `revoked_at`; `revokeAllForUser` exists
for password-reset / lockout. Deleting or cascading a membership removes the
session via the ADR 0026 composite FK; a suspended membership does not delete
the session but the guard rejects the request live each time.

### Password verification

`AuthService.login` always runs an Argon2id verify — against the real hash, or
against a process-wide **dummy hash** when the email is unknown — so timing does
not reveal account existence. Unknown user and wrong password both return
**`AUTH_INVALID_CREDENTIALS`** (401), same message. On success, if
`PasswordService.needsRehash` reports weaker stored parameters than the current
`ARGON2_*` config, the hash is transparently upgraded in the same transaction.

### Login tenant auto-selection (the "smallest secure decision")

- If the user has **exactly one** membership that is `active` **and** whose
  tenant is `active`, that membership becomes `sessions.active_membership_id` at
  login (`tenantAutoSelected: true` in the response).
- Otherwise (**zero**, **many**, or only unusable memberships)
  `active_membership_id` stays **NULL**; the client reads `memberships` from the
  login / `/auth/me` response and calls `POST /auth/switch-tenant`.
- Rationale: single-workspace users get a frictionless session; multi-workspace
  users must make an explicit, auditable choice; no tenant is ever selected from
  client input.

### Endpoints

| Route                             | Auth    | Purpose                                                         |
| --------------------------------- | ------- | --------------------------------------------------------------- |
| `POST /api/v1/auth/login`         | public  | credentials → session cookie                                    |
| `POST /api/v1/auth/logout`        | session | revoke + clear cookie                                           |
| `GET /api/v1/auth/me`             | session | user, memberships, active tenant + its permissions/roles        |
| `POST /api/v1/auth/switch-tenant` | session | set `active_membership_id` to one of the user's own memberships |

`switch-tenant` validates, in order: membership exists and belongs to the caller
(`AUTH_MEMBERSHIP_INVALID`), membership `active` (`AUTH_MEMBERSHIP_SUSPENDED`),
tenant `active` (`TENANT_SUSPENDED`); then updates the session. The ADR 0026
composite FK is the database backstop for "belongs to the caller".

### Error codes (in `@aivoryx/shared`)

`AUTH_UNAUTHENTICATED` (401), `AUTH_INVALID_CREDENTIALS` (401),
`AUTH_SESSION_EXPIRED` (401), `AUTH_SESSION_REVOKED` (401),
`AUTH_NO_ACTIVE_TENANT` (403), `AUTH_MEMBERSHIP_INVALID` (403),
`AUTH_MEMBERSHIP_SUSPENDED` (403), `TENANT_SUSPENDED` (403),
`AUTH_FORBIDDEN` (403). All rendered through the standard error envelope with a
correlation id.

## Consequences

- Redis is untouched by the auth path — a Redis outage cannot invalidate a valid
  PostgreSQL session (tested).
- CSRF: `SameSite` (+ CORS allow-list + credentials) is the baseline; a
  double-submit CSRF token is a documented follow-up (`AUTH.md`).
- `req.ip` is used for `sessions.ip`; behind a proxy it needs `trust proxy` —
  wired when deployment topology is finalised.
