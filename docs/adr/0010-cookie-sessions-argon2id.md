# ADR 0010 — Cookie Sessions + Argon2id

Status: Accepted

## Context
The product is a browser-first SaaS. Browser token storage (JWT in
`localStorage`) is an XSS liability and complicates revocation.

## Decision
- Authentication uses **server-side sessions** referenced by an **HTTP-only,
  Secure, SameSite** cookie (host-only, `Path=/`, idle + absolute lifetime,
  id rotation on privilege change).
- Session records live in a Postgres `sessions` table (source of truth); Redis
  may cache reads. Logout and admin revoke delete the record immediately.
- Passwords are hashed with **Argon2id** (per-hash salt; tuned parameters in
  config; rehash on login when parameters change).
- CSRF: SameSite cookie + double-submit token on state-changing requests; CORS
  allow-list for the web origin.
- Brute-force: per-account and per-IP rate limiting + lockout; auth events
  audit-logged. Password reset tokens are single-use, short-TTL, and revoke all
  sessions.
- No JWT for browser auth. MFA (TOTP) is not in V1 but the model reserves room.

## Consequences
Straightforward revocation and session listing; a DB read (or cache hit) per
request. Workers never use user sessions. Detail in
`docs/architecture/AUTH.md`.
