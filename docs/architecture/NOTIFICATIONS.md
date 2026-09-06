# Notifications & Communications Engine

Phase 8 — ADR 0037. A reusable, provider-neutral, cross-cutting capability that
turns committed business events into notifications and delivers them over
pluggable channels. It is **not** a workflow/automation engine.

See `docs/diagrams/notifications-flow.mmd`.

## Principle

Business modules never call `sendEmail(...)` / `sendWhatsApp(...)`. They emit
their existing `outbox_events` (ADR 0013) in the same transaction as the state
change. The notification engine consumes that stream.

```
business mutation → outbox_events (commit)
  → OutboxDispatcher → NotificationEngine → NotificationDeliveryService → channel
```

## Modules (`apps/api/src/notifications`)

| File                                                      | Responsibility                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `catalogue.ts`                                            | `DEFAULT_RULES` + `DEFAULT_TEMPLATES` (system defaults in code) and the merge with tenant overrides        |
| `template.ts`                                             | safe `{{ var }}` renderer, required-var validation, `textToSafeHtml`                                       |
| `event-context.ts`                                        | per-event **safe context builders** — read a small, explicit set of business fields; never the raw payload |
| `recipient-resolver.ts`                                   | the five strategies: `USER`, `ACTOR`, `ASSIGNED_USER`, `ROLE`, `CUSTOMER`                                  |
| `notification-preferences.service.ts`                     | per-membership channel opt-outs; evaluated before delivery                                                 |
| `idempotency.ts`                                          | deterministic dedupe / idempotency keys (sha-256, never timestamps)                                        |
| `retry.ts`                                                | transient vs permanent classification                                                                      |
| `email/`                                                  | `EmailProvider` interface + `fake` / `console` / `smtp` implementations + selector                         |
| `channels/`                                               | `ChannelAdapter` interface + `in-app`, `email`, and interface-only `whatsapp`/`sms`                        |
| `notification-engine.service.ts`                          | event → rules → context → recipients → `notifications` + `notification_deliveries` (idempotent) → enqueue  |
| `notification-delivery.service.ts`                        | one delivery row: preference gate → adapter → status transitions → retry                                   |
| `outbox-dispatcher.service.ts`                            | drains undelivered `outbox_events` cross-tenant, stamps `dispatched_at`                                    |
| `notifications.worker.ts`                                 | BullMQ worker (`drain` repeatable + `deliver`) on the shared Redis connection                              |
| `notifications.user.service.ts` / `.controller.ts`        | the signed-in user's own inbox (self-scoped, no permission)                                                |
| `notifications.admin.service.ts` / `-admin.controller.ts` | tenant rule/template/delivery administration (permission-gated)                                            |

## Database (migration `0010`)

All tenant-owned, UUIDv7 PKs, `created_at`/`updated_at`, ENABLE + FORCE RLS,
tenant-isolation policy on `app.tenant_id`, composite `(id, tenant_id)` FKs.

| Table                      | Notes                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification_templates`   | tenant override of a default, keyed `(key, channel)`. Plain-text bodies.                                                                              |
| `notification_rules`       | tenant override of a default, keyed `key`. Toggles `is_active`, narrows `channels`.                                                                   |
| `notification_preferences` | one row per membership: `in_app_enabled`, `email_enabled` (default true).                                                                             |
| `notifications`            | one per (event × rule × recipient). `dedupe_key` unique per tenant. In-app-visible when `recipient_membership_id` is set.                             |
| `notification_deliveries`  | per-channel delivery state. `idempotency_key` unique per tenant. `PENDING → PROCESSING → SENT \| FAILED \| CANCELLED`. Never stores provider secrets. |

Plus `outbox_events.actor_membership_id` (for the `ACTOR` strategy — never from
the payload) and two additive `outbox_events` policies for the dispatcher (see
Worker security).

## System defaults & tenant overrides

`DEFAULT_RULES` / `DEFAULT_TEMPLATES` ship in code, so the platform works with
zero configuration. A tenant admin's change writes a `notification_rules` /
`notification_templates` row that **overrides** the default by key. The engine
and the admin API always compute the _effective_ value
(`effectiveRules` / `mergeTemplate`).

A rule is a fixed mapping:

```
event type → template → channel(s) → recipient strategy → enabled
```

There is no arbitrary IF/THEN. Adding an event = a `DefaultRule` +
`DefaultTemplate` + (if new) a context builder. Currently mapped events:
`quotation.sent`, `quotation.accepted`, `quotation.booked`, `project.completed`,
`installation.assigned`, `visit.assigned`, `qc.failed`, `defect.created`,
`dispatch.delivered`, `purchase_order.approved`, `lead.created`.

## Channels

| Channel    | Status         | Provider                                                                                               |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `in_app`   | functional     | the `notifications` row is the deliverable                                                             |
| `email`    | functional     | provider-neutral `EmailProvider` — `fake` (tests), `console` (default), `smtp` (nodemailer, any relay) |
| `whatsapp` | interface only | `ChannelAdapter` present; delivery fails permanently with `NOTIFICATION_CHANNEL_UNAVAILABLE`           |
| `sms`      | interface only | same                                                                                                   |

`NODE_ENV=test` forces the `fake` provider — real email is never sent from
automated tests.

## Templates

`{{ dotted.path }}` interpolation only — no logic, no loops, no HTML authoring,
no executable code. `lookupPath` refuses `__proto__` / `constructor` /
`prototype` and never walks the prototype chain. Non-primitive / missing values
render empty; a missing **required** variable (inferred from the in-app title +
body) throws `NOTIFICATION_TEMPLATE_INVALID` so a half-filled message is never
sent. The email channel converts the plain-text body to escaped HTML itself, so
no author markup ever reaches a mail client and there is nothing to sanitise;
plain text is always the canonical body.

## Recipient resolution

| Strategy        | Resolves to                                                     |
| --------------- | --------------------------------------------------------------- |
| `USER`          | a configured membership                                         |
| `ACTOR`         | `outbox_events.actor_membership_id` (never the payload)         |
| `ASSIGNED_USER` | the lead / visit / installation owner (via the context builder) |
| `ROLE`          | active memberships holding a role in the tenant                 |
| `CUSTOMER`      | an external email on the related business entity                |

All resolution runs inside the event's own tenant RLS context.

## Idempotency & retries

- `notifications.dedupe_key = sha256(eventId, ruleKey, recipientRef)`
- `notification_deliveries.idempotency_key = sha256(eventId, ruleKey, recipientRef, channel)`

Both uniquely constrained per tenant. Creation is `INSERT … ON CONFLICT DO
NOTHING`; only a genuinely-inserted delivery enqueues a job (`jobId =
deliveryId`). A worker retry, restart, duplicate queue delivery or outbox
replay therefore produces **no** duplicate notification or delivery.

Transient failures re-throw for BullMQ to retry with exponential backoff up to
`NOTIFICATIONS_MAX_ATTEMPTS`; permanent failures short-circuit to `FAILED`. The
`notification_deliveries` row is the business-facing source of truth — visible
on `/admin/notifications/deliveries`.

## Worker security

The dispatcher runs as the non-privileged `aivoryx_app` role and sets a
server-only GUC `app.outbox_dispatcher = 'on'`. Migration `0010` adds two
additive policies on `outbox_events` **only**: a cross-tenant `SELECT` and the
`dispatched_at` `UPDATE`. That GUC opens no other table and cannot `INSERT`. No
client request can reach `set_config`. Per-tenant work then runs under
`app.tenant_id` from the committed event row (`withTenantSystemContext` —
tenant context, no user context). Tenant ownership is never taken from a
payload.

The notification engine is the only outbox consumer today, so it owns
`dispatched_at`. A general integration dispatcher (later phase) will add a
per-consumer offset.

## Business state is downstream

If `quotation.sent` fires and the email bounces, the quotation stays `SENT` and
the delivery row is `FAILED`. The notification subsystem never mutates business
state.

## API

Under `/api/v1`, tenant/user from `SecurityContext`, never a DTO.

**User (no permission — hard-scoped to the caller's own membership + RLS):**
`GET /notifications`, `GET /notifications/unread-count`,
`POST /notifications/:id/read`, `POST /notifications/read-all`,
`GET|PUT /notifications/preferences`.

**Admin (permission-gated):**
`GET /admin/notifications/rules`, `PATCH /admin/notifications/rules/:key`,
`GET /admin/notifications/templates`, `GET|PUT|DELETE
/admin/notifications/templates/:key`, `GET /admin/notifications/deliveries`.

## UI

- Global bell in the app shell (unread count polls every 30s), dropdown with
  recent items, click-through to the deep link, mark-all-read.
- `/settings/notifications` — per-user in-app / email toggles.
- `/admin/notifications` — rules (enable/disable, channel subset).
- `/admin/notifications/templates` — edit / reset per template.
- `/admin/notifications/deliveries` — delivery history + failures.

## Configuration

| Variable                     | Default                            | Purpose                                                                 |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `NOTIFICATIONS_ENABLED`      | `true`                             | master switch for the dispatcher + delivery worker                      |
| `NOTIFICATIONS_POLL_MS`      | `2000`                             | outbox drain interval                                                   |
| `NOTIFICATIONS_MAX_ATTEMPTS` | `5`                                | BullMQ delivery attempts before `FAILED`                                |
| `EMAIL_PROVIDER`             | `console`                          | `fake` (tests) · `console` (dev/default) · `smtp`                       |
| `EMAIL_FROM`                 | `Aivoryx <no-reply@aivoryx.local>` | `From:` identity                                                        |
| `EMAIL_SMTP_URL`             | —                                  | `smtp://user:pass@host:port` for `EMAIL_PROVIDER=smtp`; never committed |

Development and CI are safe by default. Real email needs only configuration —
no code change. Never commit SMTP passwords, API keys or credentials.

## Demo seed

`pnpm --filter @aivoryx/api seed:notifications-demo` — layers a disabled rule, a
`lead_created` template override, a sample preference row and one queued
`lead.created` event onto the `clans-demo` tenant. Idempotent. Production never
depends on it.
