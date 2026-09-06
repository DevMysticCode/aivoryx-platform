# Commercial — Customers, Quotations & Project Booking

Status: **Implemented in Phase 6** (ADR 0035). The commercial bridge from a
qualified CRM lead to an operationally activated Phase 5 project. Built ON the
existing platform — no second customer/tenant/product/project/custom-field/
permission/outbox/storage mechanism. Not an invoicing, accounting,
e-signature, or payment system — see "Strictly out of scope".

```
CRM lead → Qualified → Site visit/survey → Quotation → Acceptance → Booking → Approved project → Procurement
```

## Entities

```
customers                -- the reusable commercial party; (tenant, number) unique
  id, tenant_id, number (auto CUST-XXXXXXXX), name,
  phone? / normalized_phone?, email? / normalized_email?,
  address_line? / city? / state? / postal_code? / country?,
  site_address_line? / site_city? / site_state? / site_postal_code? / site_country?,
  tax_reference?, notes?, status (prospect|active|inactive),
  lead_id?,                         -- the lead this customer was promoted from
  created_by_membership_id, created_at, updated_at

quotations               -- (tenant, number) unique
  id, tenant_id, number (auto Q-XXXXXXXX),
  lead_id,                          -- every quotation starts from a lead
  customer_id?, project_id?,        -- both set at booking
  status (DRAFT|SENT|ACCEPTED|BOOKED|CANCELLED|EXPIRED),
  current_revision_no,
  booked_at? / booked_by_membership_id?,
  created_by_membership_id, created_at, updated_at
  -- unique (tenant_id, project_id) where project_id is not null

quotation_revisions      -- one immutable priced snapshot per number
  id, tenant_id, quotation_id, revision_no,
  status (draft|sent|accepted|superseded),
  issue_date? / validity_date? / notes?,
  subtotal / discount_total / tax_total / total (NUMERIC(18,2)),  -- STORED
  sent_at?, accepted_at?, accepted_by_membership_id?, acceptance_note?,
  created_by_membership_id, created_at, updated_at
  -- unique (tenant_id, quotation_id, revision_no)

quotation_lines          -- belong to a revision
  id, tenant_id, revision_id, line_no,
  product_id?,                      -- optional catalogue ref; null for service/custom lines
  description, unit_label?,
  quantity (NUMERIC(18,4)), unit_price (NUMERIC(18,2)),
  discount (NUMERIC(18,2)), tax_rate (NUMERIC(9,6)),
  line_net / line_tax / line_total (NUMERIC(18,2))
  -- unique (tenant_id, revision_id, line_no)

quotation_activities     -- append-only quotation timeline (mirrors lead_activities)
  id, tenant_id, quotation_id, type, actor_membership_id?, payload (jsonb), created_at

quotation_attachments    -- METADATA ONLY; bytes in object storage (mirrors dispatch_attachments)
  id, tenant_id, quotation_id, object_key, original_filename?, content_type,
  file_size, uploaded_by_membership_id?, created_at
```

All 6 tables are tenant-owned, RLS `ENABLE` + `FORCE`d, isolation-policied,
granted to `aivoryx_app`, with composite `(id, tenant_id)` FKs preventing
cross-tenant references. See `TENANCY.md` / `DATABASE.md`. Proven directly in
`apps/api/test/rls.int.spec.ts`.

## Quotation lifecycle (pure function, `apps/api/src/commercial/lifecycles.ts`)

```
DRAFT ── send ──▶ SENT ── accept ──▶ ACCEPTED ── book ──▶ BOOKED
  │                 │
  └── cancel ──▶ CANCELLED ◀── cancel ──┘
                    └── expire ──▶ EXPIRED

revise: DRAFT | SENT  ──▶  (freezes current revision, appends revision n+1, returns to DRAFT)
```

- `send` is an **internal state transition** — it freezes the current revision
  (`sent_at`), it does **not** email the customer.
- `accept` records internal acknowledgement of customer acceptance
  (`accepted_by`, `accepted_at`, optional note). Not e-signature. A quotation
  past its `validity_date` is refused with `QUOTATION_EXPIRED`.
- `send` and `accept` are idempotent (a repeat call returns the current state).

## Revision immutability (the core invariant)

- Only the **current revision while the quotation is `DRAFT`** is editable
  (`PATCH /quotations/:id` replaces its header + lines). Editing a
  `SENT`/`ACCEPTED`/`BOOKED` quotation → `QUOTATION_IMMUTABLE`.
- `revise` marks the current revision `superseded` and appends revision `n+1`
  (`draft`, copying header + lines), bumps `current_revision_no`, returns the
  quotation to `DRAFT`.
- Frozen revisions (`sent`/`accepted`/`superseded`) are never mutated — the
  code only `UPDATE`s a revision row whose status is `draft`. Every revision's
  stored pricing stays readable forever.

## Money handling

`apps/api/src/commercial/money.ts` reuses the Phase 5 fixed-point decimal
helpers. Each component is rounded to 2dp where it is computed, so the numbers
a user sees always add up:

```
gross = round(quantity × unit_price)
net   = max(0, gross − discount)
tax   = round(net × tax_rate)
total = net + tax
```

Quotation totals are the plain sums of the per-line components — so
`total = subtotal − discount_total + tax_total` is exact. No JS floating point
is ever persisted.

## Booking transaction boundary (atomic — no partial state)

`POST /quotations/:id/book` in one `withTenantContext` transaction:

| Step | Action                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `SELECT ... FOR UPDATE` the quotation (serialization point)                                                                          |
| 2    | already `BOOKED` → return the existing result (idempotent); not `ACCEPTED` → `QUOTATION_NOT_ACCEPTED`                                |
| 3    | customer: use linked `customer_id` (re-activate), else promote the lead → new customer (`customer.created`)                          |
| 4    | project: activate the pre-linked `DRAFT` project (`BOOKING_CONFLICT` if not DRAFT), else create a fresh `projects` row from the lead |
| 5    | project → `APPROVED` (`approved_at`, `approved_by_membership_id`) + `created`/`approved`/`booked` project activities                 |
| 6    | quotation → `BOOKED`, linked (`customer_id`, `project_id`, `booked_at`, `booked_by_membership_id`)                                   |
| 7    | lead → `CONVERTED` + CRM-lead timeline milestone                                                                                     |
| 8    | outbox: `quotation.booked`, `project.booked`, `project.approved` (+ `project.created`)                                               |

Two concurrent bookings serialize on the row lock; the loser sees `BOOKED` and
returns the same `projectId`. Exactly one project, one booked quotation, one
set of events. The Phase 5 project lifecycle is unchanged — booking is a new
entry into it, not a new state.

## Permissions (11 new, in the single `@aivoryx/shared` catalogue)

```
customers.read / create / update
quotations.read / create / update / send / accept / cancel / revise / book
```

`TENANT_ADMIN` holds all 11. `FIELD_AGENT` holds none. `projects.approve` is
not duplicated — booking activates the project as a trusted internal step of
`quotations.book`.

## API (`/api/v1`)

```
Customers
  GET    /customers                              customers.read
  GET    /customers/:id                           customers.read   (+ linked leads/quotations/projects)
  POST   /customers                               customers.create
  PATCH  /customers/:id                           customers.update
  POST   /customers/from-lead/:leadId             customers.create  (idempotent promotion)

Quotations
  GET    /quotations                              quotations.read
  GET    /quotations/:id                           quotations.read
  GET    /quotations/:id/activities               quotations.read
  GET    /quotations/:id/print                     quotations.read   (text/html printable document)
  POST   /quotations                               quotations.create
  PATCH  /quotations/:id                           quotations.update (current draft revision only)
  POST   /quotations/:id/revise                    quotations.revise
  POST   /quotations/:id/send                      quotations.send
  POST   /quotations/:id/accept                    quotations.accept
  POST   /quotations/:id/cancel                    quotations.cancel
  POST   /quotations/:id/expire                    quotations.update
  POST   /quotations/:id/book                      quotations.book
  GET/POST/DELETE /quotations/:id/attachments[...]  quotations.read / quotations.update
  GET    /leads/:leadId/quotations                 quotations.read

```

Every protected route derives tenant + actor user + actor membership from the
authenticated security context. Tenant ownership is never accepted from the
client. Unbounded lists are paginated.

## Stable error codes

`CUSTOMER_NOT_FOUND`, `QUOTATION_NOT_FOUND`, `QUOTATION_INVALID_TRANSITION`,
`QUOTATION_IMMUTABLE`, `QUOTATION_REVISION_REQUIRED`, `QUOTATION_NO_LINES`,
`QUOTATION_EXPIRED`, `QUOTATION_NOT_ACCEPTED`, `QUOTATION_ALREADY_BOOKED`,
`BOOKING_CONFLICT`. All returned inside the standard HTTP error envelope with
a correlation id; raw database errors are never exposed.

## Internal events (existing outbox, ADR 0013)

`customer.created`, `quotation.created`, `quotation.revised`,
`quotation.sent`, `quotation.accepted`, `quotation.cancelled`,
`quotation.expired`, `quotation.booked`, `project.booked` — each emitted in
the same transaction as its state change. No new event mechanism.

## Quotation document

`GET /quotations/:id/print` returns a self-contained, print-friendly
`text/html` page (company + customer details, number, revision, dates, line
items, totals, terms). Rendered by
`apps/api/src/commercial/quotation-doc.ts`. No PDF toolchain — the browser's
"Print → Save as PDF" is V1; a server-side PDF generator can slot in later
without touching callers.

## Web UI

`/customers`, `/customers/:id` (linked leads/quotations/projects, inline
edit); `/quotations`, `/quotations/:id` (line editor with live total preview,
revision list, timeline, attachments, "Print / PDF" link, state-and-permission
gated actions). The CRM lead detail page shows a **Quotations** card (list +
one-click create) alongside the Phase 5 project/readiness card.

## Demo / seed

`pnpm --filter @aivoryx/api seed:commercial-demo` — idempotent, layered on the
`clans-demo` tenant. Seeds a customer promoted from a lead, `Q-QB-DEMO-1`
(DRAFT with product + service lines), `Q-QB-DEMO-2` (two revisions, the first
frozen), and `Q-QB-DEMO-3` (BOOKED, with an activated `PRJ-QB-DEMO` project).
Needs `seed:supply-demo` first for products. The local demo password is
printed by the script and is not a production secret.

## Strictly out of scope this phase

Payment gateway, invoices, accounting, GST accounting engine, customer payment
tracking, e-signature / OTP acceptance, public quotation portal, Zoho
Books/Inventory, WhatsApp/email/SMS sending, automated quotation delivery,
AI/dynamic pricing, commission engine, complex discount-approval workflow,
HR/payroll, native mobile, true offline-first, microservices, and a general
workflow engine.
