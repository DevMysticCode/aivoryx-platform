# Aivoryx Architecture

## Objective

Deliver the first client's business system quickly while preserving reusable module boundaries for later Aivoryx SaaS expansion.

## Technology baseline (approved)

| Area             | Decision                                                  | ADR  |
| ---------------- | --------------------------------------------------------- | ---- |
| Architecture     | Modular monolith                                          | 0001 |
| Frontend         | Next.js + React + TypeScript, PWA-first                   | 0002 |
| Backend          | NestJS + TypeScript                                       | 0001 |
| Database         | PostgreSQL                                                | 0001 |
| ORM / migrations | Drizzle ORM                                               | 0007 |
| Identifiers      | UUIDv7 for all primary keys / external ids                | 0008 |
| Multi-tenancy    | PostgreSQL RLS + application tenant guards                | 0009 |
| Authentication   | HTTP-only cookie sessions, Argon2id                       | 0010 |
| Authorization    | Scope-aware RBAC                                          | 0011 |
| API              | REST, code-first OpenAPI, `/api/v1`                       | 0005 |
| Background work  | Redis + BullMQ workers                                    | 0012 |
| Reliability      | Transactional outbox for important events                 | 0013 |
| Observability    | Pino structured logs, correlation ids, stable error codes | 0014 |
| Object storage   | S3-compatible, Cloudflare R2 initially                    | 0015 |
| Deployment       | Vercel (web) + Railway (API, PostgreSQL, Redis, workers)  | 0006 |
| Testing          | Vitest + Playwright                                       | 0016 |
| Lead ingestion   | Generic Lead Ingestion Engine                             | 0017 |

## Architecture style

**Modular monolith + event-driven internal integration + external integration adapters.**

This is intentionally not microservices.

### Why

The team is small, the first client needs a stable system quickly, and operational complexity must remain low. Module boundaries are enforced in code so extraction into services remains possible later.

## High-level layers

1. Presentation
2. API/application
3. Domain modules
4. Shared platform services
5. Persistence/infrastructure
6. External integrations

## Core modules

- Identity
- Tenancy
- Organization
- RBAC
- Audit
- Documents
- Notifications
- Workflow
- Integration
- Jobs

## Business modules

- CRM
- HR
- Sales
- Field
- Projects
- Procurement
- Inventory
- Finance
- Service
- Solar EPC

## Key rule

Business modules must not depend on another module's database tables directly. Use module application services, contracts, and events.

## First business path

Lead Source → Connector → Adapter → Mapping → Canonical Event → Validation → Deduplicate → Lead → Assign → Telecalling → Qualification → Field → Survey → Design/BOQ → Quotation → Approval → Booking.

The ingestion portion (Source … Lead) is a reusable engine; see the integration
document map below.

## HR parallel path

Tenant → Employee → Role/Manager → Attendance → Leave → Expenses →
Compensation → Payroll → Payments → Performance.

Delivered in Phase 12 (ADR 0041, `HR-WORKFORCE.md`) as a **bounded domain
module** — other modules reach it only through narrow contracts / events, never
its 29 `hr_*` tables. An **Employee is not an Identity** (it may link to a
`user_tenant_memberships` row but never stores credentials/roles). The **only**
cross-module seam is `POST /api/v1/field/visits/:id/expense-claim`, which the
Field PWA uses to raise a claim through the same HR expense domain via the
exported `ExpensesService`. Not a statutory payroll / tax-filing / accounting
system.

## Future productization

The client is the first implementation. Generic capabilities should be configurable, not tenant-hard-coded. Client-specific behavior belongs in configuration or a clearly isolated vertical extension. No client-specific or provider-specific logic may leak into a reusable core module (ADR 0024).

## Document map

Cross-cutting:

- `TENANCY.md` — RLS + application tenant guards
- `AUTH.md` — cookie sessions, Argon2id, scope-aware RBAC
- `DEPLOYMENT.md` — Vercel + Railway topology and private networking
- `OBSERVABILITY.md` — correlation ids, log fields, error codes
- `QUALITY-GATES.md` — PR and pre-pilot gates

Lead ingestion / integrations:

- `LEAD-INGESTION.md` — the engine and its canonical pipeline
- `CONNECTORS-AND-ADAPTERS.md` — transport vs provider-shape separation
- `FIELD-MAPPING.md` — provider → canonical + custom field mapping
- `CUSTOM-FIELDS.md` — typed tenant-configurable custom fields
- `RAW-EVENTS-AND-REPLAY.md` — raw events, idempotency, retry, replay, dead-letter
- `EMAIL-INGESTION.md` — generic email connector + parsing configuration
- `PABBLY-BRIDGE.md` — Pabbly as a temporary transport, not a dependency

CRM / field / operations:

- `CRM.md` — the reusable Lead domain
- `FIELD-OPERATIONS.md` — visits, field agents, GPS, and site survey
- `SUPPLY-CHAIN.md` — projects, procurement, inventory ledger, dispatch & delivery
- `COMMERCIAL.md` — customers, quotations, revisions & atomic project booking
- `EPC-EXECUTION.md` — milestones, installation, checklists, QC, defects, net metering, handover, completion
- `NOTIFICATIONS.md` — event → rule → recipient → template → channel, delivery tracking, preferences (ADR 0037)
- `FINANCE.md` — operational invoicing, payments, allocations & credit notes (ADR 0038)
- `BRANDING.md` — tenant company profile, logo storage, brand-colour token override, onboarding & contextual help (ADR 0039)
- `DOCUMENT-GENERATION.md` — the reusable `DocumentDefinition` → `DocumentPdfService` engine; pdfmake (pure Node), branded PDF downloads (ADR 0039)
- `AUDIT.md` — the Global Audit Log: explicit + transactional, append-only, tenant-isolated; central `AuditService`, typed action catalogue, redaction, system actors (ADR 0040)
- `HR-WORKFORCE.md` — the bounded HR & Workforce module: organisation, employees (≠ identity), attendance, ledger leave balances, first-class expenses + the Field seam, compensation history, immutable payroll snapshots, performance, self-service (ADR 0041)

Diagrams: `docs/diagrams/`.
