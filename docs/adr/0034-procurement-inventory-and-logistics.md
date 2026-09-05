# ADR 0034 — Projects, Procurement, Inventory & Logistics

Status: Accepted (Phase 5 — operational project bridge, product master,
suppliers, warehouses, stock ledger, purchase orders, goods receipt, stock
allocation, dispatch & delivery)

Builds on ADR 0026 (identity/membership), ADR 0027 (RLS runtime role and
tenant transactions), ADR 0029 (RBAC / permission catalogue), ADR 0031 (CRM
core), ADR 0033 (field operations, object storage adapter), ADR 0013
(transactional outbox), ADR 0014 (error codes / correlation), and ADR 0015
(object storage). Implements the supply-chain slice **on top of** the
existing platform — no second identity, tenancy, RLS, RBAC, event,
custom-field, or storage mechanism.

## Context

Phase 5 turns a won CRM lead into a delivered set of materials on site. The
brief is explicit that the model must be **provider-neutral**: it is a
generic procurement/inventory/logistics engine that happens to be seeded with
solar demo data, not a solar ERP. No domain-specific columns
(`panel_wattage`, `inverter_capacity`, …) anywhere.

## Decision

### 1. `projects` is a thin CRM→operations bridge, not an EPC module

A `projects` row links one CRM `leads` row to the operational world. It
carries a tenant-scoped `number` (auto `PRJ-XXXXXXXX` when omitted), an
optional `customer_name`, a snapshot of the lead's site address at creation
time (so later lead edits don't silently move a project's site), a lifecycle
`status`, and `approved_at`. It holds no schedule, no budget, no tasks, no
BOQ — those are a future EPC phase. Project ≠ order: the same table serves
both "project" and "sales order" framing; we did not create a second
near-identical `orders` table.

Lifecycle (pure function `apps/api/src/supply/lifecycles.ts`, mirroring
`lead-lifecycle.ts`):

```
DRAFT -> APPROVED -> PROCUREMENT -> READY_FOR_DISPATCH -> IN_PROGRESS -> COMPLETED
             \-------\--------\----------\-----------> ON_HOLD -> (back to prior open state)
   any open state -> CANCELLED
```

`DRAFT -> APPROVED` is only reachable through the dedicated
`POST /projects/:id/approve` (permission `projects.approve`); the generic
`POST /projects/:id/status` endpoint (permission `projects.update`) rejects
that specific transition so approval is always an explicit, separately
permissioned act.

### 2. Inventory source of truth is an append-only movement ledger

`stock_movements` is immutable and append-only. Every row records a `type`
(`RECEIPT`, `ALLOCATION`, `RELEASE`, `DISPATCH`, `RETURN`, `ADJUSTMENT`,
`TRANSFER_IN`, `TRANSFER_OUT`), an absolute positive `quantity`, and the
**signed** `on_hand_delta` / `reserved_delta` it applied. `stock_levels` is a
derived projection — one row per `(tenant, warehouse, product)` with
`on_hand` and `reserved` — maintained in the same transaction as the movement
that changes it. It is never hand-edited; there is no "set quantity to N"
endpoint, only movements. A `CHECK (on_hand >= 0 AND reserved >= 0 AND
reserved <= on_hand)` constraint is the last line of defence behind the
application checks.

`available = on_hand - reserved`. Allocation increases `reserved` (not
`on_hand`); dispatch decreases both; release decreases `reserved`.

### 3. One primitive serializes all stock writes: `applyStockMovement`

`apps/api/src/supply/inventory-core.ts` is the only code that writes
`stock_movements` / `stock_levels`. It:

1. `INSERT ... ON CONFLICT DO NOTHING` to ensure the `stock_levels` row
   exists,
2. `SELECT ... FOR UPDATE` that row (the serialization point — concurrent
   movements on the same warehouse+product queue here),
3. computes the resulting `on_hand` / `reserved`, rejects an invariant breach
   with a stable error code (`INSUFFICIENT_STOCK`,
   `ALLOCATION_EXCEEDS_AVAILABLE_STOCK`, `RELEASE_EXCEEDS_ALLOCATED`,
   `NEGATIVE_STOCK_NOT_ALLOWED`),
4. inserts the movement and updates the projection.

Negative stock is never allowed in V1 (no per-tenant "allow oversell" flag —
that is a future ADR if a real use case appears).

### 4. Money & quantity are fixed-point decimal, never JS floats

`apps/api/src/supply/decimal.ts` is a small fixed-point BigInt helper
(scale 6). Quantities persist as Postgres `NUMERIC(18,4)`, money as
`NUMERIC(18,2)`. Line math (`qty × unitPrice − discount`, then
`+ net × taxRate`) and PO totals go through `lineTotal()` / `sumMoney()` —
no `Number` arithmetic touches a persisted value. This is not an accounting
engine: there are no ledgers, journals, tax jurisdictions, or currency
tables. `taxRate` is a plain per-line rate, `discount` a per-line amount.

### 5. Purchase orders: simple permissioned approval, no workflow engine

`purchase_orders` + `purchase_order_lines`. Lifecycle:

```
DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED
 DRAFT <- SUBMITTED (pull back)
 DRAFT | SUBMITTED | APPROVED -> CANCELLED
```

Only `DRAFT` POs are editable (lines are replaced wholesale on edit).
`SUBMITTED -> APPROVED` needs `procurement.approve`; everything else needs
`procurement.update`. `PARTIALLY_RECEIVED` / `RECEIVED` are set by the
receiving path (§6), not by a manual transition.

### 6. Goods receipt is one atomic transaction, idempotent on a client key

`POST /procurement/purchase-orders/:id/receive` in a single
`withTenantContext` transaction:

1. `SELECT ... FOR UPDATE` the `purchase_orders` row — the serialization
   point for concurrent receipts against the same PO,
2. **then** check the optional `idempotencyKey` against
   `goods_receipts.idempotency_key` (unique per tenant); a repeat returns the
   existing receipt with no second effect,
3. validate each line does not exceed `ordered − alreadyReceived`
   (`PO_OVER_RECEIPT`),
4. insert `goods_receipts` + `goods_receipt_lines`, bump
   `purchase_order_lines.received_qty`, call `applyStockMovement('RECEIPT')`
   per line,
5. recompute PO status (`RECEIVED` if every line is full, else
   `PARTIALLY_RECEIVED`),
6. emit `purchase_order.received` + `inventory.received` to the outbox.

The lock-**then**-idempotency-check order is deliberate and the same for
allocation and dispatch: a losing concurrent request blocks on the row lock
and, once it proceeds, sees the committed prior state — so it early-returns
instead of racing the invariant checks. Proven by real concurrent-request
integration tests, not reasoned about.

### 7. Project material requirements track four running quantities

`project_materials` — one row per `(project, product)` — holds `required_qty`,
`allocated_qty`, `dispatched_qty`, `delivered_qty`. These counters are only
ever moved by the allocation / dispatch / delivery transactions; they never
re-derive inventory, they summarise this project's claim on it. `remaining =
required − allocated` is computed for the API/UI, not stored. A requirement
cannot be reduced below what is already allocated, nor removed once anything
is allocated or dispatched.

### 8. Allocation reserves stock against a requirement, and is reversible

`POST /projects/:id/materials/allocate` — atomic:
`SELECT ... FOR UPDATE` the `project_materials` row, then idempotency check,
then assert `quantity ≤ required − allocated`
(`ALLOCATION_EXCEEDS_REQUIREMENT`), then `applyStockMovement('ALLOCATION')`
(which itself asserts `quantity ≤ available`), then bump `allocated_qty`,
then outbox `inventory.allocated`. `.../release` is the inverse
(`RELEASE_EXCEEDS_ALLOCATED` guards against releasing dispatched stock).

### 9. Dispatch & delivery: two states, no fleet management

`dispatches` + `dispatch_lines`. Lifecycle `DRAFT -> DISPATCHED ->
DELIVERED`, plus `DRAFT -> CANCELLED`. `DRAFT` is created against a project +
source warehouse with lines that may not exceed `allocated − dispatched` per
material (`DISPATCH_EXCEEDS_ALLOCATED`).

- **Dispatch** (`POST .../dispatch`, permission `dispatch.dispatch`): lock the
  dispatch row; if already `DISPATCHED`/`DELIVERED`, return it unchanged
  (status-conditional idempotency); otherwise per line
  `applyStockMovement('DISPATCH')` (decrements `on_hand` and `reserved`) and
  bump `project_materials.dispatched_qty`; outbox `dispatch.dispatched` +
  `inventory.dispatched`.
- **Deliver** (`POST .../deliver`, permission `dispatch.deliver`): lock; if
  already `DELIVERED`, return unchanged; otherwise record per-line
  `delivered_qty` (default = dispatched qty, capped at it —
  `DELIVERY_EXCEEDS_DISPATCHED`), bump
  `project_materials.delivered_qty`, set `delivered_at`; outbox
  `dispatch.delivered`.

No routes, no drivers, no vehicles, no route optimization. "Destination" is a
free-text address string.

### 10. Delivery proof reuses the Phase 4 object-storage adapter as-is

`dispatch_attachments` mirrors `visit_attachments` exactly. Upload is
`multipart/form-data`, 15 MB cap, `image/*` + `application/pdf` allow-list,
server-generated key
`tenants/<tenantId>/dispatches/<dispatchId>/<uuid><ext>` via the new generic
`buildEntityAttachmentKey` (Phase 4's `buildVisitAttachmentKey` now delegates
to it — the only Phase 4 file touched, and behaviour-preserving). Download is
the same authenticated-stream route pattern (re-checks tenant + RBAC before
touching storage). No new storage implementation; Cloudflare R2 still
deferred per ADR 0015.

### 11. Seven permission namespaces, all granted to `TENANT_ADMIN` by code

`projects.{read,create,update,approve}`, `products.{read,create,update}`,
`suppliers.{read,create,update}`, `warehouses.{read,create,update}`,
`inventory.{read,adjust,allocate,transfer}`,
`procurement.{read,create,update,approve,receive}`,
`dispatch.{read,create,update,dispatch,deliver}` — 26 keys added to the
single `PERMISSION_DEFINITIONS` catalogue in `@aivoryx/shared`. They flow to
`TENANT_ADMIN` through the existing "admin holds the whole catalogue"
mechanism (no migration, no per-tenant config). `FIELD_AGENT` gets **none**
of them — the field PWA is deliberately not an inventory app. There is still
no role-creation API.

### 12. Events reuse the existing transactional outbox

New `type` strings only — `project.created/approved`,
`purchase_order.created/approved/received`,
`inventory.received/allocated/released/adjusted/transferred`,
`dispatch.created/dispatched/delivered` — each emitted with
`OutboxService.emit(tx, …)` inside the same transaction as its state change.
No new event table or dispatcher.

### 13. Timeline reuses the CRM/visit activity pattern

`project_activities` is the append-only project timeline (created, approved,
status_changed, material_added/updated/removed, allocated, released,
purchase_order_linked, goods_received, dispatch_created, dispatched,
delivered) — same shape as `lead_activities` / `visit_activities`. No global
`audit_logs` system was introduced.

## Consequences

- Phase 5 adds **17 tenant-owned tables** (`projects`, `project_materials`,
  `project_activities`, `product_categories`, `units`, `products`,
  `suppliers`, `warehouses`, `stock_levels`, `stock_movements`,
  `purchase_orders`, `purchase_order_lines`, `goods_receipts`,
  `goods_receipt_lines`, `dispatches`, `dispatch_lines`,
  `dispatch_attachments`) — all `ENABLE` + `FORCE ROW LEVEL SECURITY`,
  tenant-isolation policy, `aivoryx_app` grants, composite `(id, tenant_id)`
  FKs to prevent cross-tenant references, following the hand-appended RLS SQL
  pattern from ADR 0030 / 0033. Verified by direct PostgreSQL RLS tests in
  `apps/api/test/rls.int.spec.ts`.
- Migration `packages/db/drizzle/0007_conscious_luminals.sql`; fresh-apply,
  rerun-idempotent, and `db:generate`-drift-clean all verified.
- Four operations are transactionally atomic with proven concurrency
  behaviour: goods receipt, allocation, dispatch, delivery. Idempotency is a
  DB unique constraint (`goods_receipts.idempotency_key`, partial unique
  `stock_movements.idempotency_key`) plus lock-then-check ordering, plus
  status-conditional early return for dispatch/deliver.
- No accounting, invoicing, payments, GST engine, quotation builder, route
  optimization, fleet/driver management, barcode hardware, bin/location
  management, serial or batch/lot tracking, demand forecasting, automated
  purchasing, workflow engine, HR/payroll, solar design/BOQ, native mobile,
  or microservices was added — all explicitly out of scope per the phase
  brief.
