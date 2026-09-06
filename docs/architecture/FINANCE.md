# Finance — Operational Invoicing & Payments

Phase 9 — ADR 0038. A reusable **operational finance layer** (invoices,
payments, allocations, credit notes), NOT an accounting system. Built ON the
existing platform — Phase 6 `customers`, the `projects` / `quotations` links,
the fixed-point money helpers, the transactional outbox, RLS, the RBAC
catalogue and the OpenAPI pipeline.

See `docs/diagrams/finance-flow.mmd`.

## What it is / is not

| Is                                                   | Is not                                                  |
| ---------------------------------------------------- | ------------------------------------------------------- |
| invoice lifecycle + immutable issued snapshot        | general ledger / journals / double entry                |
| payments, partial payments, multi-invoice allocation | chart of accounts / trial balance / P&L / balance sheet |
| credit notes / adjustments                           | bank reconciliation / bank feeds / payment matching     |
| derived outstanding + overdue                        | GST/VAT filing / tax returns / accounting periods       |
| tenant-safe numbering                                | payment-gateway integration / FX accounting             |
| finance events → Phase 8 notifications               | subscription / recurring billing / collections engine   |

Future accounting-provider sync (Zoho Books, Xero, QuickBooks) is a later
integration layer that maps these records; external ids stay out of core logic.

## Modules (`apps/api/src/finance`)

| File                      | Responsibility                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `money.ts`                | line + invoice calculations, balance math, input guards (fixed-point; no JS float)                            |
| `lifecycles.ts`           | invoice / payment / credit-note transition graphs + derived-status helper (pure)                              |
| `overdue.ts`              | `deriveOverdue(status, dueDate, outstanding, today)` — pure, cron-free                                        |
| `numbering.ts`            | `finance_counters` atomic `${prefix}${padded value}` allocation                                               |
| `idempotency.ts`          | `withIdempotency(tx, key, operation, work)` over `finance_idempotency`                                        |
| `projections.ts`          | `recalcInvoice` / `recalcPayment` — lock + recompute paid/credited/status from authoritative rows             |
| `invoices.service.ts`     | list / get / create / createFromQuotation / update draft / issue / cancel / overdue-sweep / summaries / print |
| `payments.service.ts`     | list / get / record / reverse / receipt                                                                       |
| `allocations.service.ts`  | allocate one payment across invoices (locks, over-allocation guard)                                           |
| `credit-notes.service.ts` | list / get / create / issue / cancel                                                                          |
| `finance-doc.ts`          | server-rendered printable invoice + payment receipt (no PDF toolchain)                                        |
| `*.controller.ts`         | `/finance/invoices`, `/finance/payments`, `/finance/credit-notes`, `/finance` (overview + summaries)          |

## Database (migration `0011`)

All tenant-owned, UUIDv7 PKs, `created_at`/`updated_at`, ENABLE + FORCE RLS,
tenant-isolation policy on `app.tenant_id`, composite `(id, tenant_id)` FKs,
money CHECKs.

| Table                 | Notes                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invoices`            | `number` unique per tenant; frozen `subtotal/discount_total/tax_total/grand_total`; projections `amount_paid` / `amount_credited`; CHECK `amount_paid + amount_credited <= grand_total`; currency `~ '^[A-Z]{3}$'` |
| `invoice_lines`       | snapshots `line_subtotal/discount/taxable/tax/total`; `discount_type ∈ {AMOUNT, PERCENT}`                                                                                                                          |
| `payments`            | `RECORDED → REVERSED / CANCELLED`; projection `allocated_amount`; CHECK `allocated_amount <= amount`, `amount > 0`                                                                                                 |
| `payment_allocations` | authoritative link; `unique(tenant_id, payment_id, invoice_id)`; `reversed_at` (null = active)                                                                                                                     |
| `credit_notes`        | lump adjustment; `DRAFT → ISSUED / CANCELLED`; optional `invoice_id`                                                                                                                                               |
| `finance_counters`    | `(tenant_id, kind)` → `prefix / padding / value`; atomic increment                                                                                                                                                 |
| `finance_idempotency` | `(tenant_id, key)` → `operation / result_ref`                                                                                                                                                                      |

## Source of truth for balances

```
authoritative:  active payment_allocations  +  issued credit_notes
projection:     invoices.amount_paid / amount_credited / status
                payments.allocated_amount
derived:        invoice.outstanding = grand_total − amount_paid − amount_credited (≥ 0)
                payment.unallocated = amount − allocated_amount (≥ 0)
                invoice.overdue     = ISSUED|PARTIALLY_PAID ∧ due_date < today ∧ outstanding > 0
```

Projections are recomputed under a `FOR UPDATE` lock inside every transaction
that mutates an allocation or credit note; DB CHECKs make a projection bug fail
loud rather than go negative.

## Invoice lifecycle

`DRAFT → ISSUED → PARTIALLY_PAID ⇄ PAID` · `DRAFT → CANCELLED` ·
`ISSUED|PARTIALLY_PAID → CANCELLED` (only with no active allocations) ·
`ISSUED|PARTIALLY_PAID|PAID → VOID`.
`PARTIALLY_PAID` / `PAID` are set transactionally from the projection, not by a
user request. `OVERDUE` is not a status.

## Payment lifecycle

`RECORDED → REVERSED` (undoes all active allocations, restores affected invoice
statuses, preserves the record) · `RECORDED → CANCELLED`. Payments are never
deleted.

## Concurrency & idempotency

| Scenario                                           | Mechanism                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| two allocations of one payment to one invoice      | `FOR UPDATE` (payment→invoice) + `unique(payment,invoice)` + outstanding guard → exactly one succeeds |
| duplicate record-payment / issue / reverse request | `Idempotency-Key` → `finance_idempotency` returns the same entity                                     |
| concurrent invoice numbering                       | atomic `UPDATE … value = value + 1 RETURNING` under the row lock                                      |
| concurrent reversal                                | `FOR UPDATE` + `RECORDED` guard → exactly one reversal                                                |
| projection can never go negative                   | DB CHECK `amount_paid + amount_credited <= grand_total`                                               |

## Finance events (existing outbox)

`invoice.created / issued / cancelled / voided / partially_paid / paid /
overdue` · `payment.recorded / allocated / reversed` · `credit_note.created /
issued / cancelled`. Payloads carry safe ids + a couple of display fields only.

## Phase 8 notification integration

Three default rules (`invoice_issued.customer` → email, `payment_recorded.customer`
→ receipt email, `invoice_overdue.admins` → in-app) + context builders in the
notification engine. Finance emits events; the engine consumes them. No direct
module coupling.

## API (`/api/v1`)

`/finance/overview` · `/finance/customers/:id/summary` ·
`/finance/projects/:id/summary` · `/finance/maintenance/overdue-sweep`
`/finance/invoices` (+ `/from-quotation`, `/:id`, `/:id/print`, `/:id/issue`,
`/:id/cancel`, PATCH `/:id`)
`/finance/payments` (+ `/:id`, `/:id/print`, `/:id/allocate`, `/:id/reverse`)
`/finance/credit-notes` (+ `/:id`, `/:id/issue`, `/:id/cancel`)

## UI

`/finance` overview · `/finance/invoices` + `/:id` (lines, totals, payments,
issue / cancel / record-payment / print) · `/finance/payments` + `/:id`
(allocate / reverse / receipt) · `/finance/credit-notes` + `/:id`. A read-only
finance card is embedded on the customer overview and the project workspace.

## Permissions

`finance.read`, `finance.invoices.{read,create,update,issue,cancel}`,
`finance.payments.{read,create,allocate,reverse}`,
`finance.credit_notes.{read,create,issue,cancel}`. `TENANT_ADMIN` holds all;
`FIELD_AGENT` holds none.

## Demo seed

`pnpm --filter @aivoryx/api seed:finance-demo` — one PAID, one PARTIALLY_PAID
and one overdue invoice, an unallocated payment and an issued credit note on
the `clans-demo` tenant. Idempotent. Production never depends on it.
