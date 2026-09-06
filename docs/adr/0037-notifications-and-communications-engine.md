# ADR 0037 — Notifications & Communications Engine

Status: Accepted (Phase 8 — event-driven notifications: rules, recipient
resolution, safe templates, in-app + email channels, WhatsApp/SMS interfaces,
preferences, delivery tracking, retries, idempotency)

Builds on ADR 0013 (transactional outbox), ADR 0012 (Redis + BullMQ),
ADR 0027 (RLS runtime role & per-transaction tenant context), ADR 0029 (RBAC &
permission catalogue), ADR 0014 (structured logging & stable error codes),
ADR 0015 (object storage), ADR 0024 (reusable core, no client leakage). It adds
**no** second event bus, queue technology, worker infrastructure, or
notification-provider coupling.

## Context

Business modules emit domain events into the existing `outbox_events` table but
nothing consumed them. We need notifications (a lead assigned, a quotation sent,
an installation assigned, a project completed, …) delivered to the right people
on the right channel — without every module growing `sendEmail(...)` /
`sendWhatsApp(...)` calls, and without turning this into a general
workflow/automation engine.

## Decision

### 1. Pipeline

```
business mutation → outbox_events (same tx, commit)
        → OutboxDispatcher (poll)                  [drains undelivered rows]
        → NotificationEngine (per event, per tenant RLS context)
              ├─ effective rules for event type
              ├─ safe template context builder (whitelisted fields only)
              ├─ RecipientResolver (USER | ACTOR | ASSIGNED_USER | ROLE | CUSTOMER)
              ├─ template render ({{ var }} interpolation only)
              └─ upsert notifications + notification_deliveries (idempotent)
        → BullMQ `deliver` job (attempts + exponential backoff)
        → NotificationDeliveryService
              ├─ preference gate (unless rule non-suppressible)
              └─ ChannelAdapter: in_app | email | whatsapp | sms
        → notification_deliveries.status  (PENDING→PROCESSING→SENT|FAILED|CANCELLED)
```

The notification engine is the **only** outbox consumer today, so it owns
`outbox_events.dispatched_at`. A general integration dispatcher (a later phase)
will need a per-consumer offset; adding that now would be speculative.

### 2. System defaults in code, tenant overrides in the database

`DEFAULT_RULES` and `DEFAULT_TEMPLATES` (in `@aivoryx/api`) ship the catalogue,
so the platform works with zero configuration. A row in `notification_rules` /
`notification_templates` **overrides** a default by stable key — a tenant admin
can enable/disable a rule, narrow its channels, or re-word a template with no
code change. A rule is a fixed mapping
`event type → template → channel(s) → recipient strategy`; there is no
arbitrary IF/THEN.

### 3. Channels

`in_app` and `email` are functional. `email` goes through a provider-neutral
`EmailProvider` interface — never a specific vendor. Implementations: `fake`
(deterministic, in-memory, tests only — never sends), `console` (default;
logs a safe summary), `smtp` (nodemailer transport, any relay/vendor,
`EMAIL_SMTP_URL`). `NODE_ENV=test` forces `fake`. `whatsapp` and `sms` are
`ChannelAdapter` implementations that are present but unavailable — a delivery
on them fails permanently with `NOTIFICATION_CHANNEL_UNAVAILABLE`; wiring a
vendor later means implementing `deliver()` only.

### 4. Templates are data, not code

The only templating feature is `{{ dotted.path }}` interpolation against a
whitelisted context object. No logic, no loops, no HTML authoring, no
executable code. `lookupPath` never walks the prototype chain. A missing
**required** variable fails the render (`NOTIFICATION_TEMPLATE_INVALID`) rather
than sending a half-filled message. The email channel renders the plain-text
body to escaped HTML itself (`textToSafeHtml`), so no author-supplied markup
ever reaches a mail client and there is nothing to sanitise. Plain-text is
always the canonical body. The raw event payload is never a template context —
per-event builders read a small, explicit set of business fields.

### 5. Recipient resolution

Five explicit, type-safe strategies: `USER` (a configured membership),
`ACTOR` (the membership that caused the event, taken from a new
`outbox_events.actor_membership_id` column — never the payload), `ASSIGNED_USER`
(the lead/visit/installation owner, resolved by the context builder), `ROLE`
(active memberships holding a role), `CUSTOMER` (an external email on the
related business entity). No scripting. Resolution always runs inside the
event's own tenant RLS context.

### 6. Worker DB security

The dispatcher must read undelivered `outbox_events` across tenants. It runs as
the non-privileged `aivoryx_app` role and sets a **server-only** GUC
`app.outbox_dispatcher = 'on'`. Migration `0010` adds two additive policies on
`outbox_events` only: a cross-tenant `SELECT` and the `dispatched_at` `UPDATE`.
That GUC opens no other table and cannot `INSERT`. All per-tenant work then runs
under `app.tenant_id` taken from the committed event row via
`withTenantSystemContext` (tenant context, no user context) — the payload never
supplies tenant ownership, and no client request can reach `set_config`.

### 7. Idempotency & retries

`notifications.dedupe_key = sha256(eventId, ruleKey, recipientRef)` and
`notification_deliveries.idempotency_key = sha256(eventId, ruleKey,
recipientRef, channel)`, both uniquely constrained per tenant. Creation uses
`INSERT … ON CONFLICT DO NOTHING`, and only a genuinely-inserted delivery row
enqueues a job (`jobId = deliveryId` dedupes at the queue too). So a worker
retry, process restart, duplicate queue delivery or outbox replay produces no
duplicate notification or delivery. Transient failures are re-thrown for BullMQ
to retry with exponential backoff up to `NOTIFICATIONS_MAX_ATTEMPTS`; permanent
failures (bad template, unavailable channel, hard bounce) short-circuit to
`FAILED`. The PostgreSQL `notification_deliveries` row is the business-facing
source of truth; BullMQ's failed job is just the mechanism.

### 8. Preferences

`notification_preferences` is one row per membership with `in_app_enabled` /
`email_enabled` (both default true; absence = all on). Evaluated before each
delivery. A rule may set `suppressible = false` to bypass preferences for
system-critical notices (none do yet). The model is intentionally small and
extensible — no preference matrix.

### 9. Business state is never coupled to delivery

Notifications are strictly downstream of the committed business transaction. If
`quotation.sent` fires and the email bounces, the quotation stays `SENT` and the
delivery row is `FAILED`. The notification subsystem never mutates business
state.

### 10. Permissions

Added to the catalogue: `notifications.read`, `notifications.manage`,
`notifications.templates.read`, `notifications.templates.manage`,
`notifications.deliveries.read`, `notifications.preferences.read`,
`notifications.preferences.update`. The per-user inbox + own-preferences
endpoints require **no** permission — they are hard-scoped to the caller's own
membership (plus RLS), so every authenticated member can use their own bell and
settings. Admin configuration endpoints are gated. `FIELD_AGENT` additionally
carries the three self keys for completeness.

## Consequences

- New tables (migration `0010`, all `tenant_id` + ENABLE/FORCE RLS + composite
  FKs): `notification_templates`, `notification_rules`,
  `notification_preferences`, `notifications`, `notification_deliveries`. Plus
  `outbox_events.actor_membership_id` and the two dispatcher policies.
- New env: `NOTIFICATIONS_ENABLED`, `NOTIFICATIONS_POLL_MS`,
  `NOTIFICATIONS_MAX_ATTEMPTS`, `EMAIL_PROVIDER`, `EMAIL_FROM`,
  `EMAIL_SMTP_URL`. Development and CI are safe by default (`console` / `fake`);
  real email needs only configuration.
- Adding an event = a `DefaultRule` + a `DefaultTemplate` + (if new) a context
  builder. Adding a channel = a `ChannelAdapter`. The engine does not change.

## Out of scope (later phases)

Real WhatsApp/SMS vendor integration, WhatsApp template approval, conversations,
marketing/campaigns/newsletters, a workflow/automation builder, AI message
generation, push notifications, a customer portal, an omnichannel inbox.
