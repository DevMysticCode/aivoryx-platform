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

Phase 9 (ADR 0038, `FINANCE.md`) delivered the **operational finance layer** —
an operational receivables capability, not an accounting system.

- invoices: draft → issue (immutable snapshot) → partially paid ⇄ paid ✅
- generic taxes / discounts, fixed-point money ✅
- tenant-safe, concurrency-safe numbering (`INV-000001`) ✅
- payments: record, unallocated, allocate to one/many invoices, partial, full ✅
- over-allocation rejection · currency-match · payment reversal ✅
- credit notes / adjustments ✅
- derived outstanding + overdue (no cron) ✅
- finance events → existing outbox → Phase 8 notifications ✅
- customer + project financial summaries · printable invoice + receipt ✅
- idempotency keys · concurrent-mutation safety · direct RLS tests ✅
- payables / expenses / bank-cash — deferred
- **accounting** (general ledger, chart of accounts, journals, trial balance,
  P&L, balance sheet, bank reconciliation, GST/VAT filing, accounting periods,
  depreciation) — out of scope; belongs in Zoho Books / Xero / QuickBooks via a
  future integration layer
- project costing · commissions · profitability — deferred

## Stream H — Platform experience

Phase 10 (ADR 0039, `BRANDING.md`, `DOCUMENT-GENERATION.md`) delivered
**tenant branding, onboarding and a reusable branded document engine** without
redesigning the product.

- tenant company profile & branding (generic tax label, not GST-specific) ✅
- logo storage on the existing object store · content-sniffed validation
  (PNG/JPEG/WebP only, no SVG) · authenticated logo stream ✅
- brand colour as a validated `--primary` / `--ring` token override, contrast
  clamped — never arbitrary CSS ✅
- branding in the app shell + `/auth/me`; Aivoryx-safe fallback + subtle
  "Powered by Aivoryx™" attribution kept everywhere ✅
- resumable, skippable, role-aware onboarding checklist (typed model, derived
  step state, permission-filtered links) ✅
- one reusable guidance component set + versioned in-code help copy + read-only
  lifecycle trails ✅
- reusable document engine (`DocumentDefinition` → `DocumentPdfService`) —
  **pdfmake, pure Node, no headless browser** (isolated behind one service) ✅
- real downloadable branded PDFs for quotation / invoice / receipt / credit
  note · authenticated · tenant-scoped · `application/pdf` + filename ✅
- branded notification-email wrapper (safe escaped body only, no tenant HTML) ✅
- 2 permissions (`settings.company.read` / `settings.company.update`) · direct
  RLS tests for the 3 new tables ✅
- help CMS, drag-drop document designer, custom tenant CSS/JS, customer portal,
  custom domains / white-label DNS, PDF archival, e-signatures — out of scope

## Stream I — Platform: Global Audit Log

Phase 11 (ADR 0040, `AUDIT.md`) delivered the **Global Audit & Activity Log** —
a foundational, cross-cutting capability every future module (HR included) plugs
into.

- tenant-owned, **append-only** `audit_logs` (migration 0013) — ENABLE + FORCE
  RLS, `SELECT`/`INSERT`-only grant, no update/delete policy or API ✅
- central `AuditService.record(tx, …)` — one row **inside the mutation's
  transaction**; a failed audit rolls the mutation back ✅
- typed action catalogue (`action → module`, ~70 keys) · unknown action refused ✅
- server-derived tenant + actor · `USER` from `SecurityContext`,
  `SYSTEM` from `withSystemAuditActor(...)` · composite actor FK ✅
- redaction pass — secrets stripped, size bounded, `{field:{from,to}}` diffs for
  approved fields only · full row snapshots never stored ✅
- correlation id + a new safe request-context ALS (ip / user-agent / request id) ✅
- representative high-value actions audited across Phases 2–10 ✅
- auth events recorded only when a tenant is known (login auto-select, logout,
  every tenant switch) — not a SIEM ✅
- `audit.read` permission · `GET /admin/audit` (paginated, filtered) +
  `/admin/audit/:id` · `/admin/audit` console with detail drawer ✅
- retention / archival, tamper-evident export, event-sourcing, search engine,
  trigger-based universal auditing — out of scope

## Stream G — Service

- warranty
- AMC
- tickets
- SLA
- service jobs

## Deferred

Native apps, advanced AI, monitoring, marketplace, EV/waste verticals.
