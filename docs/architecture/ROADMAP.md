# Delivery Roadmap

## Stream A — Foundation

- repository
- monorepo (pnpm workspaces + Turborepo)
- CI/CD (Vitest, Playwright, Drizzle migration validation, secret scan)
- environments (Vercel + Railway, private networking)
- authentication (cookie sessions, Argon2id)
- tenancy (PostgreSQL RLS + application guards)
- RBAC (scope-aware permissions)
- audit
- error handling (stable error-code catalogue)
- OpenAPI (code-first)
- observability (Pino, correlation ids)
- outbox + BullMQ workers
- design system
- PWA shell

## Stream A2 — Lead Ingestion Engine (shared platform capability)

Built before provider work; provider-neutral.

- source configuration model
- connector framework (webhook, email; rest_pull + pabbly_bridge interfaces)
- generic adapters (`generic_json`, `generic_form`, `generic_email_*`)
- field-mapping engine + mapping profiles
- typed custom-field engine
- raw-event store, idempotency, retry, replay, dead-letter, reconciliation
- manual review UI (`NEEDS_REVIEW`, DLQ)

## Stream B — CRM (primary)

- lead sources (config) — starting with Website forms, then Tata email, then Pabbly-bridged IndiaMART/Justdial
- lead
- customer
- deduplication policy
- assignment
- SLA
- activities
- tasks
- follow-up
- telecalling (after Bonvoice capability verification — NOT in V1)
- qualification
- sales pipeline
- performance

Meta, Google, IndiaMART, Justdial, Tata and Bonvoice **direct adapters** are
deferred until their real API/payload capabilities are verified.

## Stream C — HR (parallel)

- employee master
- organization/department
- documents
- attendance
- GPS/geo-fence for field staff
- leave
- holiday calendar
- expenses
- approvals
- performance foundations

## Stream D — Field + Sales

Phase 6 delivered the commercial workflow — customers (by lead promotion),
quotations with immutable revisions, internal acceptance, and atomic booking
that activates the Phase 5 project. See ADR 0035 and
`docs/architecture/COMMERCIAL.md`. Field design/BOQ remains for a later phase.

- field assignment
- PWA
- GPS
- check-in/out
- KM
- survey
- photos
- offline drafts
- design/BOQ
- quotation ✅ (Phase 6)
- approval ✅ (Phase 6 — commercial acceptance + booking)
- booking ✅ (Phase 6)

## Stream E — EPC

Phase 5 delivered the provider-neutral operational spine (projects,
procurement, inventory, logistics — ADR 0034, `SUPPLY-CHAIN.md`). Phase 7
delivered EPC execution — planning/milestones, material readiness,
installation assignment + field-PWA workflow, configurable checklists, QC
inspections + defects, net-metering tracking, customer handover, and
server-enforced project completion (ADR 0036, `EPC-EXECUTION.md`).

- onboarding
- projects ✅ (Phase 5)
- procurement ✅ (Phase 5)
- inventory ✅ (Phase 5)
- logistics ✅ (Phase 5)
- installation ✅ (Phase 7)
- QC ✅ (Phase 7)
- documentation
- net metering ✅ (Phase 7 — internal tracking; no utility API)
- commissioning
- handover ✅ (Phase 7)

## Stream A3 — Notifications & Communications Engine (shared platform capability)

Phase 8 (ADR 0037, `NOTIFICATIONS.md`). Provider-neutral; consumes the existing
transactional outbox — no second event bus or queue.

- outbox dispatcher + notification engine ✅
- notification rules + templates (system defaults in code, tenant overrides) ✅
- recipient resolution (USER / ACTOR / ASSIGNED_USER / ROLE / CUSTOMER) ✅
- safe `{{ variable }}` templating ✅
- in-app channel ✅ · email channel via provider abstraction ✅
- WhatsApp / SMS channel interfaces (no vendor) ✅
- per-user preferences ✅
- delivery tracking + retries + idempotency ✅
- notification bell + admin rules/templates/deliveries screens ✅
- real WhatsApp/SMS vendors, marketing/campaigns, workflow builder — deferred

## Stream F — Finance

- billing
- receivables
- payables
- expenses
- bank/cash
- GST/TDS where applicable
- project costing
- commissions
- profitability

## Stream G — Service

- warranty
- AMC
- tickets
- SLA
- service jobs

## Deferred

Native apps, advanced AI, monitoring, marketplace, EV/waste verticals.
