# CLAUDE.md — Aivoryx Engineering Constitution

## 1. Your role

You are an implementation assistant working under the direction of the human technical lead.

The human lead owns:
- product decisions
- architecture decisions
- security decisions
- business rules
- scope and priorities
- acceptance criteria

Do not silently change architecture. If a task conflicts with an architectural rule, stop and explain the conflict before implementing.

## 2. Read before coding

For every non-trivial task, read:
1. `CLAUDE.md`
2. relevant file in `docs/`
3. relevant Mermaid diagram in `docs/diagrams/`
4. relevant ADRs in `docs/adr/`

For a feature, also identify its domain owner and dependencies.

## 3. Current priority

CRM is the primary business stream. HR runs in parallel.

Priority order:
P0 Foundation
P0 CRM / Leads
P0 Lead Integrations
P0 Telecalling
P1 HR Core
P1 Field Sales
P1 Survey
P1 Quotation
P1 Booking
P2 EPC / Projects
P2 Procurement / Inventory / Logistics
P2 Finance
P3 Service / AMC
P3 AI
P3 Native mobile

## 4. Architecture

Use a modular monolith initially.

- Frontend: Next.js + React + TypeScript
- UI: Tailwind + shadcn/ui + Radix primitives + Lucide
- Server state: TanStack Query
- Forms: React Hook Form + Zod
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- Cache/queues: Redis
- API contract: OpenAPI
- Testing: Vitest/Jest as appropriate + Playwright
- Initial hosting: Railway
- Object storage: S3-compatible storage

Do not introduce microservices unless explicitly approved.

## 5. Multi-tenancy

Every business record must be tenant-scoped.

- Tenant isolation is enforced server-side.
- Never trust tenant_id from the browser.
- Resolve tenant from authenticated context.
- Repository/service methods must enforce tenant boundaries.
- Cross-tenant access must be impossible by default.

## 6. Domain boundaries

Core:
identity, tenancy, RBAC, audit, documents, notifications, workflow, integrations, jobs.

Business modules:
CRM, HR, Sales, Field, Projects, Procurement, Inventory, Finance, Service, Solar.

Modules communicate through explicit application services, APIs, and domain events. Avoid direct table manipulation across module boundaries.

## 7. Vertical slice rule

Implement features end-to-end:

database → domain/application logic → API → OpenAPI → frontend client → UI → tests → telemetry → documentation.

Do not build huge layers independently.

## 8. API rules

- Version APIs under `/api/v1`.
- Use OpenAPI as the source of truth.
- Use stable machine-readable error codes.
- Return correlation/request IDs.
- Validate all external input.
- Never expose internal stack traces to users.
- Pagination is mandatory for unbounded lists.
- Use idempotency for retriable external/event operations where appropriate.

## 9. Error UX

Never show only “Something went wrong.”

User-facing errors must explain:
- what failed
- why it failed when safe to reveal
- what the user can do
- a reference/correlation ID

Example:
“Lead could not be assigned because no eligible telecaller is available. The lead is safely queued for assignment. Reference: AIV-XXXX.”

## 10. Observability

Every important request/event/job should be traceable with:
- correlation ID
- tenant ID
- actor/user ID where available
- module
- operation
- status
- duration
- error code

External integrations must have durable event logs and retry history.

## 11. Integration architecture

Build an Aivoryx Integration Engine, not a full Pabbly clone.

V1 capabilities:
- inbound webhooks
- generic REST requests
- field mapping
- validation
- conditions
- actions
- retries
- dead-letter/failed-event handling
- integration logs

Use provider adapters for:
- website
- Meta
- Google
- IndiaMART
- Justdial
- Tata
- Bonvoice

Pabbly may remain as a temporary bridge during migration.

## 12. Frontend UX

The product must feel like polished modern SaaS, not a generic CRUD ERP.

Use:
- clear hierarchy
- compact, readable tables
- consistent status semantics
- strong loading/empty/error states
- responsive layouts
- mobile-first field workflows
- minimal typing for field users
- accessible controls
- no unnecessary animation

Never introduce a new component pattern if an existing shared component can be reused.

## 13. Performance

- Prefer Server Components when interactivity is not required.
- Keep client components small.
- Lazy-load heavy libraries such as maps/charts/editors.
- Avoid giant API payloads.
- Use pagination and selective fields.
- Cache appropriate read queries.
- Show useful UI immediately with skeletons/cached data.
- Do not block the entire page on unrelated widgets.

Performance is a feature requirement.

## 14. PWA

PWA first for field/customer/employee experiences.

Offline-safe:
- drafts
- reference data
- queued photos
- queued GPS events
- notes/forms

Must require server confirmation for:
- financial posting
- booking confirmation
- payment confirmation
- payroll completion
- final inventory transfer

Never display “success” until the server has accepted a critical operation.

## 15. Testing

Every completed vertical slice needs:
- typecheck
- lint
- unit tests where business logic exists
- integration/API tests
- Playwright coverage for critical user journeys

Golden journeys must remain green:
1. Lead → telecaller
2. Telecaller → qualified lead
3. Qualified lead → field visit
4. Survey → quotation
5. Quotation → booking
6. Employee → attendance/leave

## 16. Claude working style

Before coding:
- summarize understanding
- identify files to change
- identify reusable components
- identify risks
- identify tests

After coding:
- run checks
- review diff
- update docs/diagrams if architecture changed
- report files changed
- report tests run
- report known limitations

Never claim success without actually running the relevant checks.

## 17. Scope discipline

Do not:
- add speculative features
- create abstractions without a current use case
- introduce dependencies casually
- refactor unrelated code
- rewrite working modules just for style
- implement future modules while a P0 feature is incomplete

Prefer the smallest production-safe implementation that preserves the agreed architecture.

## 18. Definition of Done

A feature is not done until:
- acceptance criteria pass
- tenant/security checks pass
- API contract is updated
- UI states are complete
- errors are actionable
- tests pass
- telemetry exists for important operations
- documentation is updated
- no unrelated regressions are introduced
