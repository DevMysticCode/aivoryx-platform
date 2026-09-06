# Global Audit & Activity Logging

Phase 11 — ADR 0040. A tenant-owned, **append-only** record of important
business & security actions: who did what, to which entity, in which tenant,
when, from which request, in which module, and what safe data changed. It is a
foundational platform capability — every future module (HR included) records
through the same service.

See `docs/diagrams/audit-flow.mmd`.

## Principle

Audit is **explicit and transactional**, not automatic. Business services call
one central `AuditService.record(tx, …)` for meaningful state changes, **inside
the same transaction** as the mutation:

```
withTenantContext(scope, async (tx) => {
  …state change…
  await outbox.emit(tx, …)     // async propagation (ADR 0013) — NOT the audit
  await audit.record(tx, …)    // authoritative, synchronous, same tx
})   // COMMIT: state + audit together, or neither
```

A failed audit write fails the transaction and rolls the mutation back — a
successful critical mutation cannot silently occur without its audit row.

There is **no** trigger-on-every-write, **no** "log every UPDATE" middleware,
and **no** UI-only logging. Reads (GET / lists / dashboards) are never audited.

## Audit vs business activity

|            | Business activity timeline | Global audit log  |
| ---------- | -------------------------- | ----------------- |
| Audience   | sales / ops                | admins / security |
| Scope      | one entity                 | tenant-wide       |
| Mutability | product-defined            | **immutable**     |
| Focus      | context                    | actor             |

A single mutation may produce **both** — that is intended. The per-entity
timelines (lead / quotation / visit / project) are unchanged.

## Data model — `audit_logs` (migration 0013)

`id` (UUIDv7) · `tenant_id` · `actor_membership_id` (nullable) · `actor_type`
(`USER` | `SYSTEM`) · `actor_source` (nullable, e.g. `notification-worker`) ·
`action` · `entity_type` · `entity_id` (nullable UUID) · `module` ·
`correlation_id` · `request_id` · `occurred_at` (DB clock) · `metadata` (JSONB) ·
`changes` (JSONB, nullable) · `ip_address` · `user_agent`.

- **CHECK** `audit_logs_action_format` — `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`.
- **CHECK** `audit_logs_actor_shape` — a `SYSTEM` row never carries a membership
  (a `USER` row supplies one at insert time, enforced by `AuditService`; the id
  may later become NULL if that member is removed — "a former member did this").
- **Composite FK** `(actor_membership_id, tenant_id) → user_tenant_memberships`
  makes a cross-tenant actor impossible at the DB level; `ON DELETE SET NULL
(actor_membership_id)` nulls only the actor id so the row survives.
- **5 indexes**: `(tenant_id, occurred_at desc)` and the same prefixed by
  `actor_membership_id` / `action` / `(entity_type, entity_id)` / `module`.

## Append-only & immutable

Migration 0013 **REVOKEs UPDATE, DELETE** on `audit_logs` from `aivoryx_app`
and re-GRANTs `SELECT, INSERT` only. RLS is `ENABLE` + `FORCE` with a
tenant-isolated **SELECT** policy and a tenant-checked **INSERT** policy — and
**no UPDATE or DELETE policy**. There is no edit / delete / bulk-delete /
"clear logs" API. Retention / archival is a **future** platform concern and
must preserve integrity — Phase 11 deletes nothing.

## Actor model

| actor    | how it is set                                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USER`   | `userActor(scope)` → the authenticated `SecurityContext` membership. Never a DTO field.                                                                                                                     |
| `SYSTEM` | `withSystemAuditActor('notification-worker' \| 'integration-worker' \| 'scheduled-job' \| 'system', fn)` — an ALS set only in server code. `AuditService.record` reads it when no explicit actor is passed. |

A client can never submit `actor_type` or an actor id. `AuditService` throws if
neither an explicit actor nor a system-actor context is present, and rejects a
`USER` actor with an empty membership id.

## Redaction (`audit.redaction.ts`)

Callers pass **small, intentional** payloads. Everything is then sanitised:

- `sanitizeMetadata(obj)` — drops any key matching `password | secret | token |
hash | credential | authorization | api key | cookie | session | bearer |
refresh/access token | private key | signature | smtp | webhook | raw payload
| otp | pin`; truncates strings > 2000 chars; bounds depth (6) and array
  length (50); drops functions / symbols; ISO-stringifies dates.
- `buildChanges(before, after, fields)` — `{ field: { from, to } }` for an
  **approved** field list only; emits a field only if it actually changed.
- `sanitizeChanges(obj)` — the same guarantees for a caller-supplied
  `{field:{from,to}}` object.

Full before/after row snapshots are never stored. Prefer ids, statuses, codes,
amounts and operational state.

## Request context

`correlation_id` from the existing ALS (ADR 0014). A small
`observability/request-context.ts` ALS (populated by a middleware right after
the correlation handler) carries **only** ip / user-agent / request id — never
auth headers, cookies or bodies. `occurred_at` is always the DB clock. In this
platform the pino request id equals the correlation id; the `request_id` column
is kept for forward-compatibility. Missing ip/ua/request-id is fine (background
jobs). **Note**: correct client IP behind the production proxy requires
Express `trust proxy`, which is a separate infra setting; until then `ip_address`
may be the proxy address.

## Auth events

`auth.login` / `auth.logout` / `auth.tenant_switched` are recorded **only when a
tenant is known** — a single-membership auto-selected login, a logout with an
active membership, and every tenant switch — attributed to that membership. A
multi-tenant user's bare login is not written to any tenant's log (it is
covered by the request log and the `auth.tenant_switched` that follows). These
use best-effort `recordSafe` so an audit hiccup never fails the auth flow.
Phase 11 is not a security-event SIEM.

## Action catalogue

`apps/api/src/audit/audit.actions.ts` — a frozen `action → module` map, the
single source of truth. Services use these keys, never literals.
`AuditService.record` rejects an unknown action (`AUDIT_ACTION_UNKNOWN`). Keys
are stable once shipped. Groups: `auth.*`, `tenant.member.*`, `tenant.updated`,
`crm.lead.*`, `integration.source.*` / `integration.event.replayed`,
`field.visit.*` / `field.lead.created`, `project.*` / `product.created` /
`supplier.created` / `warehouse.created` / `purchase_order.*` / `inventory.*`,
`customer.*` / `quotation.*`, `project.installation.*` / `project.qc.*` /
`project.defect.*` / `project.handover.updated` / `project.completed`,
`notification.{rule,template,preference}.*`, `finance.{invoice,payment,credit_note}.*`,
`settings.{company,branding,logo,onboarding}.updated`.

## Integration pattern

Add auditing to an existing mutation:

```ts
constructor(private readonly audit: AuditService) {}          // @Global module

await this.audit.record(tx, {
  tenantId: scope.tenantId,
  action: 'finance.invoice.issued',       // from the catalogue
  entityType: 'invoice',
  entityId: id,
  actor: userActor(scope),                // or omit inside withSystemAuditActor
  changes: { status: { from: inv.status, to: 'ISSUED' } },
  metadata: { number: inv.number, grandTotal: inv.grandTotal },
});
```

Placed **after** the state change + `outbox.emit`, **inside** the same
`withTenantContext` transaction. Idempotent replay paths place the call after
the early-return so a replay does not duplicate the row.

## API

`audit.read` permission only — there is no write API.

| Route                         | Notes                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/audit`     | paginated; server-side filters: `from`, `to`, `actorMembershipId`, `actorType`, `action`, `module`, `entityType`, `entityId`, `page`, `pageSize` (≤ 100) |
| `GET /api/v1/admin/audit/:id` | safe detail (`AuditLogDetailDto`); 404 for another tenant's id                                                                                           |

Responses are the narrow `AuditLogDto` / `AuditLogDetailDto`, never the raw
row. Actor name/email is one LEFT JOIN — no N+1.

## UI

`/admin/audit` (Admin → Audit log) — a restrained console: filter bar,
compact table (time / actor / action / module badge / entity), pagination, and
a detail drawer that renders `changes` as `field: from → to` and `metadata` as
a key/value list (never raw JSON), with best-effort deep links from `entity_id`
to the record. Uses the Phase 10 shell + tenant branding.

## Testing

- Unit: `audit.actions.spec.ts` (catalogue), `audit.redaction.spec.ts`
  (redaction / `buildChanges`), `audit.service.spec.ts` (actor resolution,
  unknown action, sanitisation, `recordSafe`).
- Integration (`test/audit.int.spec.ts`): audit written in the mutation's tx;
  **a failed audit rolls the mutation back**; `audit.read` gate; no write API;
  attribution + filtering + pagination; cross-tenant 404; secrets never stored;
  SYSTEM actor rows.
- RLS (`test/rls.int.spec.ts`): as `aivoryx_app` — A can't read/insert B; no
  context ⇒ nothing; UPDATE denied (42501); DELETE denied (42501); cross-tenant
  actor FK (23503); SYSTEM-with-membership and malformed-action CHECKs (23514);
  `SELECT`/`INSERT`-only grant.
- Playwright (`apps/web/e2e/audit.spec.ts`): admin performs an audited action →
  Admin → Audit log → finds it → inspects detail → filters → another tenant's
  entry is not visible → no secrets in the row.

## Future extension points

Retention / archival (integrity-preserving), tamper-evident export, an audit
webhook / outbox projection, per-action verbosity config, and a saved-view /
digest layer — all deliberately **out of Phase 11**.
