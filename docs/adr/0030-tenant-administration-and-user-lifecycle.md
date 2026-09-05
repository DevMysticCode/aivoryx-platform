# ADR 0030 — Tenant Administration & User Lifecycle

Status: Accepted (Phase 2, Task 3 — tenant administration)

Builds on ADR 0026 (identity/membership model), ADR 0027 (RLS runtime role +
per-transaction tenant context), ADR 0028 (session lifecycle), ADR 0029 (RBAC +
permission catalogue) and ADR 0013 (transactional outbox). Adds no new
authentication system and no new authorization model.

## Context

Task 2 delivered the security boundary and a read-only `/admin` surface that
existed only to exercise the guard + RLS. Task 3 turns that into a usable — but
still minimal — tenant-administration capability: a `TENANT_ADMIN` can view and
rename the current workspace, see its members, invite people, run the membership
lifecycle (invite → active → suspended → removed) and assign/remove the generic
platform roles from ADR 0029. No business modules (CRM/HR/…) are in scope.

## Decision

### 1. Administration boundary

- New authenticated endpoints under `/api/v1/admin`, each gated by one existing
  catalogue permission (ADR 0029) and additionally RLS-scoped to the active
  tenant:

  | Method + path                                        | Permission           |
  | ---------------------------------------------------- | -------------------- |
  | `GET  /admin/tenant`                                 | `tenants.read`       |
  | `PATCH /admin/tenant`                                | `tenants.update`     |
  | `GET  /admin/members`                                | `memberships.read`   |
  | `GET  /admin/members/:membershipId`                  | `memberships.read`   |
  | `POST /admin/members` (invite)                       | `users.create`       |
  | `PATCH /admin/members/:membershipId` (status)        | `memberships.update` |
  | `DELETE /admin/members/:membershipId`                | `users.delete`       |
  | `POST /admin/members/:membershipId/roles`            | `memberships.update` |
  | `DELETE /admin/members/:membershipId/roles/:roleKey` | `memberships.update` |
  | `GET  /admin/roles`                                  | `roles.read`         |
  | `GET  /admin/permissions`                            | `permissions.read`   |

- The Task 2 route `GET /admin/memberships` is **renamed** to `GET /admin/members`
  (same `memberships.read` permission, same response shape plus `name` and an
  `invitationPending` flag). It was an internal scaffolding endpoint with no
  external consumers.
- `PATCH /admin/tenant` edits **only** `name`. `slug` and `status` are
  platform-managed and not editable here.
- Every service method runs inside `withTenantContext` (ADR 0027). A membership,
  role or invitation belonging to another tenant is invisible and unmodifiable —
  cross-tenant reads return `404`, cross-tenant writes affect zero rows.
- Backend authorization stays authoritative. The web UI mirrors nothing: it calls
  the same endpoints and renders whatever the server returns or rejects.

### 2. Invitation lifecycle (provider-neutral)

`tenant_invitations` — tenant-bound, membership-bound, single-use:

- `token_hash` stores **only** the SHA-256 (hex) of a 256-bit
  `randomBytes(32)` token — the same principle as session tokens (ADR 0028). The
  plaintext token is generated once, returned once from `POST /admin/members`
  for the onboarding hand-off, and **never** persisted or returned by any other
  authenticated API.
- Status: `pending → accepted` (single-use) or `pending → revoked`. A partial
  unique index `(membership_id) WHERE status = 'pending'` guarantees at most one
  live invitation per membership; re-inviting an address revokes the previous
  pending row in the same transaction.
- `expires_at` from `INVITATION_TTL_HOURS` (default 168h / 7 days).
- Acceptance (`POST /api/v1/auth/accept-invitation`, `@Public()`) is the only
  place a token is consumed. It does **not** create a session — the invitee signs
  in normally afterwards, so there remains exactly one authentication path.
- Stable error codes: `INVITATION_INVALID` (unknown token, 400),
  `INVITATION_EXPIRED` (410), `INVITATION_REVOKED` (410),
  `INVITATION_ALREADY_USED` (replay / already accepted, 409),
  `INVITATION_PASSWORD_REQUIRED` (first-time account, 400).
- Replay protection: acceptance is a conditional
  `UPDATE tenant_invitations SET status='accepted' WHERE id=? AND status='pending'
RETURNING id` — zero rows ⇒ `INVITATION_ALREADY_USED`. The membership is
  activated in the same transaction.

**No email/SMS/WhatsApp provider is built.** The one-time token is surfaced in the
admin UI for the administrator to relay out of band; a future notifications
module can consume the outbox event instead.

### 3. Initial-credentials decision

The identity model (ADR 0026) already allows `users.password_hash IS NULL`
(pre-provisioned account). Invitation acceptance is the **first-password-set**
path of that existing model, not a second auth system:

- If the invited user has no password, `password` is **required** on
  `accept-invitation` and is hashed with the existing `PasswordService`
  (Argon2id) and written with `password_updated_at = now()`.
- If the user already has a password (they were invited to an additional
  workspace, or re-invited), no password is required or accepted — their
  existing credential is untouched.

No password-reset, MFA, or lockout is added (explicitly out of scope; ADR 0028
already reserves room).

### 4. Outbox event boundary

Creating an invitation writes exactly one `outbox_events` row —
`type = 'user.invitation.created'` — in the **same transaction** as the
invitation state (ADR 0013). Payload: `invitationId`, `membershipId`, `userId`,
`email`, `expiresAt`, `invitedByUserId`; `correlation_id` from the request
context. No dispatcher, provider, or second outbox mechanism is introduced —
`outbox_events` is the same table ADR 0013 defines, now created and RLS-protected.

### 5. RLS additions

Both new tables get `ENABLE` + `FORCE ROW LEVEL SECURITY` and a tenant-isolation
policy (`USING`/`WITH CHECK` on
`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`, fail
closed — ADR 0027).

`tenant_invitations` additionally carries a **by-token** policy, mirroring the
`utm_self_read` pre-context pattern from ADR 0027: the public accept flow has no
session and no tenant context, so it binds `app.invitation_token_hash` to exactly
the token it holds and the policy then exposes only that one row. The service
uses a new `withProgressiveContext` transaction helper — bind the token hash,
read + validate the invitation, then widen the context to the invitation's **own
(server-derived)** `tenant_id` before touching the membership. The tenant is
never client-supplied, so a token cannot act across tenants.

### 6. Last-administrator invariant

An operation that would leave a tenant with **zero active memberships holding
`TENANT_ADMIN`** is rejected with `TENANT_LAST_ADMIN` (409). Enforced before:
suspend of an active admin membership, removal of an admin membership, and
removal of the `TENANT_ADMIN` role from an active admin membership
(`countUsableTenantAdmins(tx, tenantId, excludeMembershipId)` inside the same
transaction).

## Security invariants (implemented + tested)

`apps/api/test/tenant-admin.int.spec.ts` and `apps/api/test/rls.int.spec.ts`
(the latter run directly as `aivoryx_app`) cover:

- Tenant A cannot read/modify Tenant B members, tenant settings, roles, or
  invitation state; cross-tenant reads → 404, writes → 0 rows / `42501`.
- A suspended or removed membership cannot operate in that tenant.
- Revoked / expired / already-accepted / replayed / unknown / wrong-tenant
  invitations are all rejected with their stable codes.
- The token hash is what is stored; the plaintext token is not persisted and is
  not echoed by `GET /admin/members[/:id]`.
- Non-admin → 403; unauthenticated → 401 (never conflated).
- The last usable `TENANT_ADMIN` cannot be suspended, removed, or de-roled.

## Consequences

- New schema: `tenant_invitations`, `outbox_events`, `users.name`,
  `membership_status` gains `'invited'` (migration `0004`).
- New config: `INVITATION_TTL_HOURS` (default 168).
- Web: a small `/admin` area (Overview, Members, Workspace settings) plus
  `/login` and `/accept-invitation`, built only from the existing
  Next.js + Tailwind + `@aivoryx/ui` stack. No new UI library.
- A future notifications module consumes `user.invitation.created`; a future
  tenant-provisioning flow reuses `provisionTenantAdmin` (ADR 0029).
- Still deferred: audit logging, password reset, MFA, brute-force lockout,
  Redis session cache, business roles.
