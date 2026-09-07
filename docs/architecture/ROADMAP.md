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

Phase 12 (ADR 0041, `HR-WORKFORCE.md`) delivered the **HR & Workforce** module
— a bounded domain that other modules reach only through narrow contracts /
events, never its tables:

- organisation config (departments / designations / locations / lightweight
  schedules) — all tenant-configurable, nothing hardcoded ✅
- employee master with a server-generated, concurrency-safe tenant number
  (`EMP-000001`), an explicit lifecycle state machine, and effective-dated
  employment history that is never overwritten ✅
- **Employee ≠ Identity** — an employee may link to a `user_tenant_memberships`
  row (composite FK) but never stores credentials / roles / sessions ✅
- attendance: server-time only, one row/day (no overlaps), optional
  straight-line GPS, immutable audited corrections ✅
- leave: types + policies + **ledger balances** (`opening + accrued + adjusted −
consumed` as a generated column); configurable approver strategy
  (reporting-manager / HR / designated / admin); overlap + concurrent-approval
  safe; no self-approval ✅
- expenses: first-class claim → approval → reimbursement; frozen approved
  amounts; mileage from a tenant rate; **the same domain serves a field agent
  through `POST /field/visits/:id/expense-claim`** (the only Field → HR seam) ✅
- compensation history (supersede, never overwrite; no salary in audit) ·
  generic incentives ✅
- payroll: period → process → **finalize (immutable per-employee snapshot)** →
  payment recording; exact fixed-point money; branded payslip PDF via the
  Phase 10 document engine ✅
- performance: lightweight periods / goals / reviews (DRAFT → SUBMITTED →
  ACKNOWLEDGED → CLOSED) ✅
- employee self-service at `/hr/me` — resolved from the session, fails closed
  when unlinked, never another employee's sensitive data ✅
- `hr.*` permission catalogue (35 keys; compensation & bank-details isolated) ·
  `hr` audit module (~44 actions) · notification events via the existing outbox
  (no direct email/SMS calls) · every HR table RLS `ENABLE` + `FORCE` ✅
- statutory payroll / tax filing / bank-API integration / an accounting
  replacement / recruitment / biometric attendance / shift rostering — out of
  scope

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

## Stream J — Platform Access & Module Entitlements

Phase 13A (ADR 0042, `PLATFORM-ACCESS.md` / `MODULE-ENTITLEMENTS.md` /
`AUTHORIZATION.md`) delivered the **platform-access foundation** — the product
layer above a tenant. Authorization order is fixed: **tenant module entitlement
→ profile / permission set → data scope → allow / deny**.

- **code** module catalogue (`@aivoryx/shared` `MODULE_DEFINITIONS`, 7 modules)
  with a dependency model (`COMMERCIAL → CRM+SUPPLY`, `EPC → COMMERCIAL+SUPPLY+FIELD`)
  and `moduleForPermission` (every business key → one module; platform keys → none) ✅
- `tenant_module_entitlements` (migration 0015) — tenant-owned, ENABLE + FORCE
  RLS, additive `*_platform_read` SELECT policy (migration 0017); central
  `EntitlementService` (tenant-scoped in the query, RLS the backstop) ✅
- global `platform_admins` (migration 0015) — SELECT-only to `aivoryx_app`,
  self-read; `PlatformAdminService`; `@PlatformAdmin()` boundary, tenant-less;
  grant/revoke is seed/migration only ✅
- `roles.kind` (`profile|permission_set|custom`) + `membership_roles.data_scope`
  (`OWN|TEAM|DEPARTMENT|COMPANY`) — Profiles / Permission Sets / Data Scopes on
  the **existing** RBAC machinery, no second model; `AccessService` +
  `/admin/access`, `/admin/profiles`, `/admin/permission-sets`, effective-access
  read ✅
- `SecurityGuard` checks module entitlement **before** the permission for every
  route with zero per-controller changes; `ENTITLEMENT_MODULE_NOT_ENABLED` is a
  distinct code from `AUTH_FORBIDDEN` ✅
- `/platform/*` API (overview, catalogue, workspaces, dependency-checked
  enable/disable) · 4 new permissions (148 total) · 11 new error codes ·
  `platform.module.*` + access-config audit actions ✅
- `pnpm --filter @aivoryx/api run seed:platform-demo` — Company A (all 7),
  Company B (CRM + SUPPLY), a global platform admin; deterministic, rerunnable ✅
- integration + RLS + concurrency coverage: `platform.int.spec.ts` (20),
  `access.int.spec.ts` (12, full §50 matrix), `rls.int.spec.ts` Phase 13 block
  (+9) ✅
- billing / metering / Stripe, microservices, SSO / SAML / SCIM, MFA, a runtime
  platform-admin API, ABAC, a dashboard builder — out of scope

### Phase 13B — Premium product experience & CRM flagship (`PRODUCT-UX.md`)

- adaptive **application shell** (desktop sidebar / tablet / mobile bottom-nav +
  "More" sheet); `/field/*` keeps its own PWA chrome, untouched ✅
- **centralized module-aware navigation registry**
  (`apps/web/lib/navigation/registry.ts`) filtered by platform role + tenant
  entitlements + effective permissions; unauthorised links are never rendered
  (nav, command palette, search, quick actions all consult one `useAccess()`) ✅
- **account menu + company switcher** — secure `switch-tenant`, full query-cache
  reset on switch; logout always visible ✅
- **platform-admin console** — `/platform` overview, `/platform/tenants` table
  (search/sort/filter, mobile cards), `/platform/tenants/:id` module management
  with dependency-aware enable/disable + confirmation + verbatim rejection
  messages, `/platform/modules` catalogue ✅
- **tenant access UX** — `/admin/access`: Users (profile + data scope + permission
  sets + effective access), Profiles, Permission Sets, module-grouped permission
  picker limited to entitled modules, plain-language helper text ✅
- **⌘/Ctrl-K command palette** — navigate / create / search leads + customers,
  every command permission- and module-gated; debounced, keyboard-navigable ✅
- **notification bell** — the Phase 8 bell integrated into the shell top bar ✅
- **CRM flagship (reference UX)** — `/crm` overview with real KPIs (leads by
  status, open, qualified, conversion) from the existing endpoint, module
  sub-nav, `?new=1` quick-create, `?status=` deep links ✅
- shared UI kit (`components/ui/*`: overlays, toast, command palette, kit) on the
  existing tokens; no second styling system; Radix adoption recommended, not
  taken, in 13B ✅
- one minimal API refinement: `EffectiveAccessDto` gained typed nested
  `profile` / `permissionSets` DTOs so the contract is usable client-side ✅
- Playwright: `platform.spec.ts` (§64) + `crm-ux.spec.ts` (§65); full existing
  suite green (17/17) ✅
- **NOT done (deferred):** role-aware dashboard framework at `/` (still the
  Phase-1 placeholder); CRM lead-list rebuild (kanban / saved-view persistence /
  bulk actions / mobile cards) and the lead-detail workspace redesign; per-module
  entitlement-aware empty states beyond the stable API message; promoting the
  shared kit into `packages/ui`; per-module mobile refinement for HR/Field/etc.
- out of scope (unchanged): billing, dashboard builder, arbitrary themes/nav
  builder, ABAC / field-level security, universal search engine, CRM automation /
  marketing automation, BI platform, separate frontend apps

## Stream G — Service

- warranty
- AMC
- tickets
- SLA
- service jobs

## Deferred

Native apps, advanced AI, monitoring, marketplace, EV/waste verticals.
