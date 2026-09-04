# ADR 0010 — Cookie Sessions + Argon2id

Status: Accepted

## Context

The product is a browser-first SaaS. Browser token storage (JWT in
`localStorage`) is an XSS liability and complicates revocation.

## Decision

- Authentication uses **server-side sessions** referenced by an **HTTP-only,
  Secure, SameSite** cookie. The cookie carries **only the session identifier**
  (host-only, `Path=/`, idle + absolute lifetime, id rotation on privilege
  change). No session state or user data is stored in the cookie.
- **PostgreSQL is the authoritative session store.** Session records live in a
  Postgres `sessions` table and it is the single source of truth for session
  existence, expiry and revocation. Logout and admin revoke delete the record
  immediately.
- **Redis must not be the authoritative session store.** Redis MAY later be
  introduced as an optional read-through cache for session lookups, but
  application correctness must not depend on Redis being available: every
  session read must fall back to Postgres, and a Redis outage must not log users
  out, grant access, or lose revocations. This cache does not exist in Phase 2's
  initial implementation and is a separate, later decision.
- Passwords are hashed with **Argon2id** (per-hash salt; tuned parameters in
  config; rehash on login when parameters change).
- CSRF: SameSite cookie + double-submit token on state-changing requests; CORS
  allow-list for the web origin.
- Brute-force: per-account and per-IP rate limiting + lockout; auth events
  audit-logged. Password reset tokens are single-use, short-TTL, and revoke all
  sessions.
- No JWT for browser auth. MFA (TOTP) is not in V1 but the model reserves room.

## Consequences

Straightforward revocation and session listing; one Postgres read per
authenticated request (indexed lookup on the session id). Workers never use user
sessions. If request latency from that read becomes a problem, an optional
Postgres-backed cache in front of it can be considered later without changing
this decision. Detail in `docs/architecture/AUTH.md`.

## History

- 2025 — original decision (Postgres source of truth, "Redis may cache reads").
- Phase 1 gate — clarified by the technical lead: PostgreSQL is authoritative;
  Redis is explicitly **not** a session store and correctness must never depend
  on it.
