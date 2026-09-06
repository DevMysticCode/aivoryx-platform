# ADR 0040 — Global Audit & Activity Logging

Status: Accepted (Phase 11 — a tenant-owned, append-only audit log; a central
`AuditService`; a typed action catalogue; a redaction pass; a system-actor
context; an `audit.read` read API + admin console)

Builds on ADR 0027 (RLS runtime role & per-transaction tenant context),
ADR 0029 (RBAC & permission catalogue), ADR 0014 (correlation ids & stable
error codes), ADR 0013 (transactional outbox), ADR 0039 (polished admin UI).
It adds **no** second event bus, **no** trigger-based universal auditing, **no**
SIEM, and **no** search engine.

## Context

Through Phase 10 the platform could run a business end-to-end, but there was no
authoritative, tenant-wide answer to "who changed this, when, and from where?".
The per-entity timelines (lead / quotation / visit / project activities) are
business-facing and contextual; they are not an administrative/security record
and they are not uniform across modules. Phase 11 adds a **Global Audit Log** as
a foundational platform capability that every future module — including HR —
plugs into.

## Decision

### 1. Explicit, not automatic

Audit rows are written by business services calling a central
`AuditService.record(tx, …)` for **meaningful state-changing or
security-relevant actions** — not by a database trigger on every write, not by
"log every UPDATE" middleware, and not from the UI. Reads (GET, lists,
dashboards) are never audited. Trigger-based universal auditing was rejected: it
cannot express intent, cannot redact safely, and floods the log with noise.

### 2. Transactionally tied to the mutation

`AuditService.record` inserts **one row inside the caller's transaction** (the
`tx` handle is passed in). For a critical mutation the pattern is:

```
withTenantContext(scope, async (tx) => {
  …business state change…
  await outbox.emit(tx, …)          // async propagation (ADR 0013)
  await audit.record(tx, …)         // authoritative, synchronous
})   // COMMIT — state + audit together, or neither
```

If the audit write fails, the transaction fails and the mutation rolls back. A
successful critical mutation therefore cannot silently occur without its audit
row. The outbox is **not** the audit mechanism — it is asynchronous and for
downstream propagation; audit is synchronous and authoritative. A
best-effort `recordSafe` variant exists **only** for informational security
events (login / logout) where failing the auth flow on an audit hiccup would be
worse than a missing row; it is never used for a business mutation.

### 3. Domain model — `audit_logs` (migration 0013)

One tenant-owned table: `id` (UUIDv7), `tenant_id`, `actor_membership_id`
(nullable), `actor_type` (`USER` | `SYSTEM`), `actor_source` (nullable, e.g.
`notification-worker`), `action`, `entity_type`, `entity_id` (nullable UUID),
`module`, `correlation_id`, `request_id`, `occurred_at` (DB clock), `metadata`
(JSONB), `changes` (JSONB, nullable), `ip_address`, `user_agent`. DB CHECKs
enforce the action-key format and the actor shape (`USER` ⇒ membership present;
`SYSTEM` ⇒ membership absent). Five `(tenant_id, …, occurred_at desc)` indexes
cover the console's filters (time, actor, action, entity, module).

### 4. Append-only & immutable

The schema-wide default privileges grant every verb to `aivoryx_app`; migration
0013 **REVOKEs UPDATE, DELETE** on `audit_logs` and re-GRANTs `SELECT, INSERT`
only. RLS is `ENABLE` + `FORCE` with a tenant-isolated **SELECT** policy and a
tenant-checked **INSERT** policy — and deliberately **no UPDATE or DELETE
policy**, so even a future accidental grant cannot mutate history. There is no
edit / delete / bulk-delete / "clear logs" API. Retention / archival is a
separate future platform concern and must preserve audit integrity.

### 5. Tenant & actor integrity

Tenant is always the server-derived active tenant (`scope(ctx)` / a trusted
system context) — never a DTO field. The actor is either the authenticated
membership (`{ type: 'USER', membershipId }`) or a trusted server-side system
context (`withSystemAuditActor('notification-worker', …)`) — a client can never
submit `actor_type` or an actor id. On top of app-level derivation, the
composite foreign key `(actor_membership_id, tenant_id) → user_tenant_memberships`
makes a cross-tenant actor **impossible at the database level**.

### 6. Typed action catalogue

`apps/api/src/audit/audit.actions.ts` is the single source of truth: a frozen
map of `action → module`. Services reference these keys, never bare strings.
`AuditService.record` rejects an action that is not in the catalogue
(`AUDIT_ACTION_UNKNOWN`). Keys are stable once shipped (they are queried and
filtered on).

### 7. Redaction — safe, intentional payloads

Callers pass small, intentional `metadata` (ids, statuses, codes, amounts) and
`changes` (`{ field: { from, to } }` for an **approved** field list only —
`buildChanges(before, after, fields)`). Everything is then run through
`sanitizeMetadata` / `sanitizeChanges`: any key that looks sensitive
(password, secret, token, hash, credential, authorization, api key, cookie,
session, bearer, refresh/access token, private key, signature, smtp, webhook,
raw payload, otp, pin) is replaced with `[redacted]`; long strings are
truncated; object depth and array length are bounded; non-serialisable values
are dropped. Full before/after row snapshots are **not** stored.

### 8. Request context

`correlation_id` comes from the existing correlation ALS (ADR 0014). A small
new request-context ALS (`observability/request-context.ts`), populated by a
middleware right after the correlation handler, carries **only** the client IP,
the user-agent string and the request id — never authorization headers,
cookies or bodies. In this platform the pino request id and the correlation id
are the same value; the `request_id` column is kept distinct for
forward-compatibility. `occurred_at` is always the database clock, never a
client value. Background jobs supply their worker/job context; missing
IP/UA/request-id is fine.

### 9. Auth events & the tenant boundary

Authentication can happen before a tenant is resolved. Rather than invent
tenant ownership for a global login, Phase 11 records `auth.login` /
`auth.logout` / `auth.tenant_switched` **only when a tenant is known** (a
single-membership auto-selected login, a logout with an active membership, and
every tenant switch — the target tenant is always known there), attributing
them to the active membership. A multi-tenant user's bare login is **not**
written to any tenant's log (it is covered by the structured request log and by
the `auth.tenant_switched` that follows). Phase 11 is not a security-event
SIEM.

### 10. Business activity vs audit

The per-entity activity timelines are unchanged and remain business-facing. A
single mutation may legitimately produce **both** a business activity row and
an audit row — that is intended. The audit log is the administrative / security
history: immutable, actor-focused, tenant-wide, authoritative.

### 11. Permissions & API

One new permission: `audit.read` (read-only — there is no write API). Not
granted to a user just because they can use a business module; `TENANT_ADMIN`
holds it via the full catalogue. `GET /api/v1/admin/audit` (paginated,
server-side filtering by `from` / `to` / `actorMembershipId` / `actorType` /
`action` / `module` / `entityType` / `entityId`) and
`GET /api/v1/admin/audit/:id` (safe detail). Responses are a narrow DTO
(`AuditLogDto` / `AuditLogDetailDto`), never the raw row. The actor's
name/email is resolved with a single LEFT JOIN — no N+1.

### 12. UI

`/admin/audit` — a restrained SaaS audit console using the Phase 10 shell and
tenant branding: filter bar, compact table (time / actor / action / module
badge / entity), pagination, a detail drawer that renders `changes` as
`field: from → to` and `metadata` as a key/value list (never a raw JSON dump),
best-effort deep links from `entity_id` to the record, and proper
empty/loading/error states. The tenant's identity stays primary; the subtle
"Powered by Aivoryx™" attribution is unchanged.

## Consequences

- New table (migration `0013`, `tenant_id` + ENABLE/FORCE RLS + composite
  `(id, tenant_id)`-style actor FK + action/actor CHECKs + 5 indexes),
  2 enums (`audit_actor_type`, `audit_module`). 1 permission, 4 error codes
  (`AUDIT_ACTION_UNKNOWN`, `AUDIT_TENANT_REQUIRED`, `AUDIT_ACTOR_REQUIRED`,
  `AUDIT_LOG_NOT_FOUND`).
- New `apps/api/src/audit/` module (`@Global` so any module can inject
  `AuditService`), and a request-context ALS in observability.
- Representative high-value actions across every phase (2–10) now record audit
  rows inside their existing transactions. No environment variables added.
- Every future module (HR included) records via the same `AuditService`.

## Out of scope (later phases)

Retention / archival policy and jobs, tamper-evident external storage,
event-sourcing, an audit report designer, SIEM / security analytics, full-text
search / Elasticsearch, and trigger-based universal database auditing.
