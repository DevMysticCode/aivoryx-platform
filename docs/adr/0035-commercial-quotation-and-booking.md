# ADR 0035 — Commercial: Customers, Quotations & Project Booking

Status: Accepted (Phase 6 — commercial party model, quotation model + lifecycle,
immutable revisions, internal acceptance, atomic booking that activates the
Phase 5 project)

Builds on ADR 0026 (identity/membership), ADR 0027 (RLS runtime role and
tenant transactions), ADR 0029 (RBAC / permission catalogue), ADR 0031 (CRM
core / lead lifecycle), ADR 0033 (field operations, object storage adapter),
ADR 0034 (projects / procurement / inventory), ADR 0013 (transactional
outbox), ADR 0014 (error codes / correlation), and ADR 0015 (object storage).
Implements the commercial slice **on top of** the existing platform — no
second identity, tenancy, RLS, RBAC, product, project, custom-field, event, or
storage mechanism.

## Context

Phase 6 closes the gap between a qualified CRM lead and an operationally
activated Phase 5 project: `CRM lead → quotation → acceptance → booking →
approved project → procurement`. The brief is explicit that this is **not** an
invoicing / accounting / e-signature / payment system, and that it must reuse
the existing customer-adjacent data (leads) and the existing `projects` table
rather than creating parallel entities.

## Decision

### 1. `customers` is the smallest reusable commercial party, created by promotion

A `customers` row carries identity/contact/address, an optional site address,
a tax reference, `status` (`prospect | active | inactive`), and — when it was
promoted from a lead — `lead_id`. It is **not** an ERP customer master (no
credit terms, price lists, contacts sub-table, hierarchy).

A lead becomes a customer by **promotion**, not duplication:
`promoteLeadTx` copies the lead's authoritative contact/address into a new
`customers` row, sets `lead_id`, and is **idempotent per lead** — a second
call returns the customer already promoted from that lead and re-activates it.
Booking calls this automatically when a quotation has no linked customer; it
is also exposed as `POST /customers/from-lead/:leadId` and a plain
`POST /customers` for a manually-created customer.

### 2. Quotation = header + numbered revisions + lines; totals are stored

- `quotations` — tenant-scoped `number` (auto `Q-XXXXXXXX`), `lead_id`
  (always — every quotation starts from a lead), optional `customer_id` and
  `project_id` (both set at booking), `status`, and `current_revision_no`.
- `quotation_revisions` — one immutable priced snapshot per revision number,
  with its own `status` (`draft | sent | accepted | superseded`), validity
  date, notes, and the **stored** money totals (`subtotal`, `discount_total`,
  `tax_total`, `total`). Totals are persisted, not only derived, so a
  historical revision's pricing is fixed even if a product's catalogue price
  later changes.
- `quotation_lines` — belong to a revision. `product_id` is **optional**: an
  existing catalogue product may be referenced (and its name snapshotted into
  `description`), but service/labour/custom lines are a free-text
  `description` with no product. The product catalogue is never polluted with
  one-off items.

### 3. Money is fixed-point decimal, rounded per component

`apps/api/src/commercial/money.ts` reuses the Phase 5 fixed-point helpers
(`../supply/decimal.js`). Every component is rounded to 2dp where it is
computed, so displayed numbers always add up:

```
gross = round(quantity × unit_price)
net   = max(0, gross − discount)
tax   = round(net × tax_rate)
total = net + tax
```

Quotation totals are the plain sums of the per-line components, which keeps
the identity `total = subtotal − discount_total + tax_total` exact.
Quantities persist as `NUMERIC(18,4)`, money as `NUMERIC(18,2)`, tax rate as
`NUMERIC(9,6)`. No `Number` arithmetic touches a persisted value. This is not
an accounting engine — no ledgers, journals, currencies, or tax jurisdictions.

### 4. Quotation lifecycle — four states, no workflow engine

```
DRAFT → SENT → ACCEPTED → BOOKED
DRAFT → CANCELLED
SENT  → CANCELLED | EXPIRED
```

Enforced by a pure function (`apps/api/src/commercial/lifecycles.ts`),
mirroring `crm/lead-lifecycle.ts` and `supply/lifecycles.ts`. `send` is an
**internal state transition only** — it freezes the current revision; it does
**not** email the customer (external delivery is a future integration).
Acceptance is recorded internally by an authorized user (`accepted_by`,
`accepted_at`, `acceptance_note` on the revision) — this is explicitly not
e-signature. `send` and `accept` are idempotent: a repeat call on an
already-sent / already-accepted quotation returns the current state rather
than erroring.

### 5. Revision immutability — the core commercial-history invariant

Only the **current revision while the quotation is `DRAFT`** may be edited
(`PATCH /quotations/:id` replaces its header + lines). Any edit attempt once
the quotation is `SENT`/`ACCEPTED`/`BOOKED` is rejected with
`QUOTATION_IMMUTABLE`.

`revise` (`POST /quotations/:id/revise`, permitted while `DRAFT` or `SENT`)
marks the current revision `superseded`, inserts revision `n+1` (`draft`,
copying the header + lines), bumps `current_revision_no`, and returns the
quotation to `DRAFT`. Frozen revisions (`sent`/`accepted`/`superseded`) are
never mutated — the code only ever `UPDATE`s a revision row whose status is
`draft`. Historical revisions and their pricing stay fully readable.

### 6. Booking is one atomic transaction that activates the Phase 5 project

`POST /quotations/:id/book` (permission `quotations.book`) runs entirely in
one `withTenantContext` transaction:

1. `SELECT ... FOR UPDATE` the `quotations` row — the serialization point for
   concurrent bookings.
2. If already `BOOKED`, return the existing booking result (idempotent). If
   not `ACCEPTED`, reject `QUOTATION_NOT_ACCEPTED`.
3. Resolve the customer: use `customer_id` if linked (and re-activate it),
   otherwise `promoteLeadTx` the lead → new customer (`customer.created`).
4. Resolve the project: if the quotation pre-links a `project_id` it must be
   `DRAFT` (else `BOOKING_CONFLICT`) and is activated in place; otherwise a
   fresh `projects` row is created from the lead's site snapshot. The
   **existing Phase 5 `projects` table** is used — there is no `orders`
   entity.
5. Move the project to `APPROVED` (`approved_at`, `approved_by_membership_id`)
   — commercial acceptance/booking is commercial approval; project
   `APPROVED` is the **operational activation point** (ADR 0034 lifecycle,
   unchanged).
6. Update the quotation → `BOOKED`, fully linked (`customer_id`,
   `project_id`, `booked_at`, `booked_by_membership_id`).
7. Move the lead → `CONVERTED` (booking _is_ the conversion) and write the
   CRM-lead timeline milestone.
8. Emit `quotation.booked`, `project.booked`, `project.approved` (and
   `project.created` when a project was created) to the existing outbox.

There is no partial state: a crash rolls the whole thing back. Two concurrent
bookings serialize on the row lock; the loser sees `BOOKED` and returns the
same `projectId` — exactly one project, one booked quotation, one set of
events. Proven by a real concurrent-request integration test.

`unique(tenant_id, project_id) where project_id is not null` on `quotations`
guarantees at most one quotation owns a given project.

### 7. Permissions — 11 new keys in the single catalogue

`customers.{read,create,update}`,
`quotations.{read,create,update,send,accept,cancel,revise,book}` — added to
`PERMISSION_DEFINITIONS` in `@aivoryx/shared`. They flow to `TENANT_ADMIN`
through the existing "admin holds the whole catalogue" mechanism.
`FIELD_AGENT` gets none. `projects.approve` is **not** duplicated: booking
performs the project activation as a trusted internal step of
`quotations.book` (the same way Phase 5 goods-receipt posts stock movements
without requiring `inventory.adjust`).

### 8. Printable quotation — server-rendered HTML, no PDF toolchain

`GET /quotations/:id/print` returns a self-contained `text/html` document
(inline CSS, `@media print`) rendered by `apps/api/src/commercial/quotation-doc.ts`.
The browser's own "Print → Save as PDF" is sufficient for V1. The rendering
is isolated so a real server-side PDF generator can be added later without
touching the service or the API. No PDF library is introduced.

### 9. Attachments & timeline reuse existing mechanisms

`quotation_attachments` mirrors `dispatch_attachments` (Phase 5) exactly:
`multipart/form-data`, 15 MB cap, image/PDF allow-list, server-generated key
`tenants/<tenantId>/quotations/<id>/<uuid><ext>` via `buildEntityAttachmentKey`,
authenticated-stream download that re-checks tenant + RBAC. No new storage
adapter. `quotation_activities` is the append-only quotation timeline (same
shape as `lead_activities` / `project_activities`); four milestones
(`quotation_created/sent/accepted/booked`) are also written to the existing
`lead_activities` table so the CRM lead timeline shows the commercial
transition. No global `audit_logs` system.

## Consequences

- Phase 6 adds **6 tenant-owned tables** (`customers`, `quotations`,
  `quotation_revisions`, `quotation_lines`, `quotation_activities`,
  `quotation_attachments`) — all `ENABLE` + `FORCE ROW LEVEL SECURITY`,
  tenant-isolation policy, `aivoryx_app` grants, composite `(id, tenant_id)`
  FKs, following the hand-appended RLS SQL pattern from ADR 0030 / 0033 / 0034. Verified by direct PostgreSQL RLS tests in
  `apps/api/test/rls.int.spec.ts`.
- Migration `packages/db/drizzle/0008_grey_betty_ross.sql`; also adds
  `quotation_created/sent/accepted/booked` to `lead_activity_type` and
  `booked` to `project_activity_type` via `ALTER TYPE ... ADD VALUE`.
  Fresh-apply, rerun-idempotent, and `db:generate`-drift-clean all verified.
- The Phase 5 `projects` lifecycle is **unchanged** — booking is a new
  _entry_ into it (`DRAFT → APPROVED`), not a new state.
- No payment gateway, invoicing, accounting, GST engine, e-signature, OTP,
  public quotation portal, external email/SMS/WhatsApp sending, AI/dynamic
  pricing, commission engine, discount-approval workflow, HR/payroll, native
  mobile, or microservices was added — all explicitly out of scope per the
  phase brief.
