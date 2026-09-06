# ADR 0038 — Operational Finance: Invoicing & Payments

Status: Accepted (Phase 9 — invoices, invoice lines, payments, payment
allocations, credit notes/adjustments, tenant-safe numbering, derived overdue,
customer/project financial summaries)

Builds on ADR 0035 (customers / quotations / booking), ADR 0034 (projects),
ADR 0013 (transactional outbox), ADR 0027 (RLS runtime role & per-transaction
tenant context), ADR 0029 (RBAC & permission catalogue), ADR 0014 (stable
error codes), ADR 0037 (notification engine consumes finance events). It adds
**no** second customer/party model, event bus, or provider coupling.

## Context

The platform can take a lead through quotation → booking → project →
execution → completion, but there was no way to invoice a customer, record a
payment, or see what is outstanding. Phase 9 adds an **operational finance
layer** — enough to run a project/service business's receivables — without
becoming an accounting system.

## Decision

### 1. Operational finance, not accounting

There is **no** general ledger, chart of accounts, journals, double entry,
trial balance, P&L, balance sheet, bank reconciliation, tax filing, accounting
periods or statutory accounting. Those belong in a dedicated provider (Zoho
Books, Xero, QuickBooks). The records here — customer, invoice, invoice line,
payment, payment allocation, credit note — are shaped so a future integration
layer can map them 1:1 to an external accounting system; external
provider ids are kept out of core logic.

### 2. Generic domain model

No solar/EPC-specific columns. An invoice belongs to an existing Phase 6
`customers` row and may reference a `projects` / `quotations` row. Lines carry
a generic `quantity / unit_price / discount_type(AMOUNT|PERCENT) / discount_value
/ tax_name / tax_rate` and snapshot every computed component.

### 3. Money

Reuses the Phase 5 fixed-point decimal helpers (`apps/api/src/supply/decimal.ts`)
via `apps/api/src/finance/money.ts` — decimal strings, never JS floats;
PostgreSQL `NUMERIC(18,2)` money, `NUMERIC(18,4)` quantity, `NUMERIC(9,6)`
rate. Each component is rounded to 2dp where it is computed, so
`grand_total = subtotal − discount_total + tax_total` is exact. Currency is
explicit on every invoice / payment / credit note (3-letter ISO, DB CHECK); no
FX conversion, no multi-currency accounting — an allocation must be
same-currency.

### 4. Invoice lifecycle & immutability

`DRAFT → ISSUED → PARTIALLY_PAID ⇄ PAID`, plus `CANCELLED` / `VOID`. A draft is
fully editable; **issuing freezes the financial snapshot** (lines, totals,
customer, currency, issue date) — corrections are made by cancelling/voiding
and raising a new invoice, or by a credit note. `PARTIALLY_PAID` / `PAID` are
**derived** from allocations, moved transactionally by the service, not
user-driven. Cancelling an issued invoice is refused while it has active
payment allocations.

### 5. Overdue is derived, never stored

`overdue = status ∈ {ISSUED, PARTIALLY_PAID} ∧ due_date < today ∧ outstanding > 0`,
computed in the DTO layer with `days_overdue`. No cron mutates status. An
opt-in, idempotent `POST /finance/maintenance/overdue-sweep` emits
`invoice.overdue` once per invoice (guarded by `overdue_notified_at`) so
Phase 8 can react; correctness does not depend on it running.

### 6. Numbering

`finance_counters (tenant_id, kind)` with `prefix` / `padding` / `value`. The
next number is `${prefix}${value padded}` (e.g. `INV-000001`), reserved with a
single atomic `UPDATE … SET value = value + 1 RETURNING` inside the creating
transaction, so concurrent creates in one tenant never collide. Configurable
enough (prefix/padding per tenant+kind); deliberately not a numbering-rule
engine. UUIDv7 remains the internal id — never the human number.

### 7. Payments & allocation

A payment is authoritative and is **never deleted**: `RECORDED → REVERSED /
CANCELLED`. It may be recorded fully unallocated and allocated later. A
`payment_allocations` row links a payment to an invoice; one payment can be
split across many invoices, one invoice can receive many payments.
`unique(tenant_id, payment_id, invoice_id)` + `FOR UPDATE` locks (payment
first, then invoice) + the DB CHECK `amount_paid + amount_credited <=
grand_total` make over-allocation and concurrent-allocation races impossible.
**Over-allocation is rejected** (`ALLOCATION_EXCEEDS_INVOICE` /
`ALLOCATION_EXCEEDS_PAYMENT`) — money is never silently discarded and unrelated
invoices are never auto-mutated. There is no customer-credit / overpayment
balance in this phase.

### 8. Reversal

`POST /finance/payments/:id/reverse` locks the payment, guards on `RECORDED`
(idempotent if already `REVERSED`), stamps `reversed_at` on the payment and
every active allocation, recomputes each affected invoice's projection + status
(so `PAID → PARTIALLY_PAID → ISSUED` on the way back), and emits
`payment.reversed`. The payment row and the fact it was reversed are preserved.

### 9. Credit notes

A minimal lump adjustment: `number / customer / optional invoice / reason /
amount / currency / status`. No `credit_note_lines`. `DRAFT → ISSUED /
CANCELLED`. Issuing (when linked to an invoice) is refused if the amount
exceeds the invoice's outstanding, then reduces the invoice's receivable
(projection). Cancelling an issued one restores it. Issued credit notes are
immutable.

### 10. Balance — one authoritative calculation

Authoritative records: **active `payment_allocations`** and **issued
`credit_notes`**. `invoices.amount_paid` / `amount_credited` and
`payments.allocated_amount` are transactional **projections** recomputed from
those rows under a row lock in the same transaction that mutates them
(`finance/projections.ts`). `outstanding` / `unallocated` are always derived,
never stored. DB CHECKs (`amount_paid + amount_credited <= grand_total`,
`allocated_amount <= amount`) mean a projection bug fails loud, not silently
negative. Integration tests assert projection consistency.

### 11. Idempotency

Mutating operations (`create invoice`, `issue`, `record payment`, `allocate`,
`reverse`, `create/issue credit note`) accept an optional `Idempotency-Key`
header. `finance_idempotency (tenant_id, key)` records the first request's
result id; a retry returns the same entity; a key reused for a _different_
operation is rejected. Not timestamp-based.

### 12. Events

Finance emits to the existing `outbox_events` (no second bus):
`invoice.created / issued / cancelled / voided / partially_paid / paid /
overdue`, `payment.recorded / allocated / reversed`, `credit_note.created /
issued / cancelled`. Payloads carry only safe ids + a couple of display fields
— never a whole row, never a client-supplied tenant. Phase 8 gains three
default rules (invoice issued → customer email, payment recorded → customer
receipt email, invoice overdue → admins in-app), plus context builders; no
direct coupling to `NotificationModule`.

### 13. Security

Every endpoint requires an authenticated user, an active tenant, an explicit
`finance.*` permission, a tenant-context transaction and RLS. Tenant, actor,
customer, project, invoice and payment ownership is always derived
server-side — never from a DTO. `FIELD_AGENT` gets **no** finance permissions;
`TENANT_ADMIN` gets all via the full catalogue.

## Consequences

- New tables (migration `0011`, all `tenant_id` + ENABLE/FORCE RLS + composite
  `(id, tenant_id)` FKs + money CHECKs): `invoices`, `invoice_lines`,
  `payments`, `payment_allocations`, `credit_notes`, `finance_counters`,
  `finance_idempotency`. 14 permissions, ~21 error codes.
- No new environment variables.
- Adding an invoice source / payment method / tax = data, not schema. Adding an
  accounting-provider sync = a future integration layer over these records.

## Out of scope (later phases)

Double-entry / GL / CoA / P&L / balance sheet / trial balance / bank
reconciliation / GST-VAT filing / payroll accounting / depreciation /
accounting periods; payment-gateway integration, bank feeds, automatic payment
matching, FX accounting, subscription / recurring billing, financing/EMI,
collections workflow, advanced analytics, Zoho/Xero/QuickBooks integration,
customer portal.
