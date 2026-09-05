# Supply Chain — Projects, Procurement, Inventory & Logistics

Status: **Implemented in Phase 5** (ADR 0034). A provider-neutral
operational spine built on top of the existing platform — no second
identity/tenancy/RLS/RBAC/outbox/storage mechanism. Seeded with solar demo
data; contains **zero** solar-specific columns. Not an ERP, an accounting
engine, a WMS, or a fleet system — see "Strictly out of scope" below.

## Entities

```
projects                 -- thin CRM -> operations bridge (not an EPC module)
  id, tenant_id, lead_id, number (unique per tenant), customer_name?,
  status, site_address_line? / site_city? / site_state?,   -- snapshot at creation
  approved_at?, created_by_membership_id, created_at, updated_at

project_materials        -- one row per (project, product)
  id, tenant_id, project_id, product_id,
  required_qty, allocated_qty, dispatched_qty, delivered_qty,   -- NUMERIC(18,4)
  notes?, created_at, updated_at

project_activities       -- append-only project timeline (mirrors lead_activities)
  id, tenant_id, project_id, type, actor_membership_id?, payload (jsonb), created_at

units         -- (tenant, code) unique
  id, tenant_id, code, name, is_active
product_categories       -- (tenant, code) unique
  id, tenant_id, code, name, is_active
products                 -- item master; (tenant, sku) unique
  id, tenant_id, sku, name, description?, unit_id, category_id?,
  brand?, model?, reorder_level? (NUMERIC), is_active, created_at, updated_at

suppliers                -- vendor record, NOT an AP ledger; (tenant, code) unique
  id, tenant_id, code, name, contact_name? / contact_email? / contact_phone?,
  address_line? / city? / state? / postal_code? / country?, tax_reference?,
  notes?, is_active, created_at, updated_at
warehouses               -- stock-holding location; (tenant, code) unique
  id, tenant_id, code, name, type (main|regional|transit|site),
  address_line? / city? / state? / postal_code? / country?, is_active, created_at

stock_movements          -- APPEND-ONLY LEDGER, the source of truth
  id, tenant_id, warehouse_id, product_id, type,
  quantity (absolute > 0), on_hand_delta (signed), reserved_delta (signed),
  project_id?, reference_type? / reference_id?, idempotency_key?, notes?,
  created_by_membership_id?, created_at
  -- type in RECEIPT | ALLOCATION | RELEASE | DISPATCH | RETURN |
  --            ADJUSTMENT | TRANSFER_IN | TRANSFER_OUT
  -- partial unique (tenant_id, idempotency_key) where idempotency_key is not null

stock_levels             -- DERIVED projection, maintained in the same tx as the movement
  id, tenant_id, warehouse_id, product_id, on_hand, reserved, updated_at
  -- unique (tenant_id, warehouse_id, product_id)
  -- CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)
  -- available = on_hand - reserved (computed, not stored)

purchase_orders          -- (tenant, number) unique
  id, tenant_id, supplier_id, project_id?, number, status,
  order_date? / expected_date? / notes?,
  subtotal / tax_total / discount_total / total (NUMERIC(18,2)),
  approved_at?, created_by_membership_id, created_at, updated_at
purchase_order_lines
  id, tenant_id, purchase_order_id, line_no, product_id,
  ordered_qty, received_qty (NUMERIC(18,4)),
  unit_price / tax_rate / discount / line_total (NUMERIC)

goods_receipts           -- (tenant, number) unique; (tenant, idempotency_key) unique
  id, tenant_id, purchase_order_id, warehouse_id, number, notes?,
  idempotency_key?, received_by_membership_id?, received_at
goods_receipt_lines
  id, tenant_id, goods_receipt_id, purchase_order_line_id, product_id, received_qty

dispatches               -- (tenant, number) unique
  id, tenant_id, project_id, warehouse_id, number, status,
  destination_address?, notes?, delivery_notes?,
  dispatched_at? / delivered_at?, created_by_membership_id, created_at, updated_at
dispatch_lines
  id, tenant_id, dispatch_id, line_no, product_id, quantity, delivered_qty
dispatch_attachments     -- METADATA ONLY; bytes live in object storage (mirrors visit_attachments)
  id, tenant_id, dispatch_id, object_key, original_filename?, content_type,
  file_size, uploaded_by_membership_id?, created_at
```

All 17 tables are tenant-owned, RLS `ENABLE` + `FORCE`d, isolation-policied,
granted to `aivoryx_app`, with composite `(id, tenant_id)` FKs preventing
cross-tenant references — see `TENANCY.md` and `DATABASE.md`. Proven directly
in `apps/api/test/rls.int.spec.ts`.

## Lifecycles (pure functions, `apps/api/src/supply/lifecycles.ts`)

```
project:   DRAFT -> APPROVED -> PROCUREMENT -> READY_FOR_DISPATCH -> IN_PROGRESS -> COMPLETED
           open state -> ON_HOLD -> prior open state ;   open state -> CANCELLED
           DRAFT -> APPROVED only via POST /projects/:id/approve (projects.approve)

purchase order:  DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED
                 SUBMITTED -> DRAFT ;   DRAFT|SUBMITTED|APPROVED -> CANCELLED
                 PARTIALLY_RECEIVED / RECEIVED are set by the receiving path, not manually

dispatch:  DRAFT -> DISPATCHED -> DELIVERED ;   DRAFT -> CANCELLED
```

## Inventory rules

- `stock_movements` is immutable and append-only. There is no "set quantity"
  operation — every change is a typed movement carrying its own signed
  `on_hand_delta` / `reserved_delta`.
- `stock_levels` is a projection updated in the **same transaction** as its
  movement. `applyStockMovement` (`apps/api/src/supply/inventory-core.ts`) is
  the only writer: it `SELECT ... FOR UPDATE`s the level row (serialization
  point), validates the resulting invariants, then writes both rows.
- `available = on_hand - reserved`. Allocation raises `reserved`; dispatch
  lowers `on_hand` and `reserved`; release lowers `reserved`.
- Negative stock is never allowed (no per-tenant override in V1). Cross-tenant
  movements are impossible (RLS + composite FKs). Same-warehouse transfers are
  rejected (`TRANSFER_SAME_WAREHOUSE`).
- Quantities are `NUMERIC(18,4)`, money `NUMERIC(18,2)`. All arithmetic uses
  the fixed-point helper `apps/api/src/supply/decimal.ts` — never JS floats.

## Transaction boundaries (all atomic, no partial state)

| Operation     | In one transaction                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goods receipt | lock PO → idempotency check → over-receipt check → insert receipt(+lines) → bump line received_qty → `RECEIPT` movement(s) → recompute PO status → outbox |
| Allocation    | lock project_material → idempotency check → `≤ required−allocated` check → `ALLOCATION` movement (`≤ available`) → bump allocated_qty → outbox            |
| Release       | lock project_material → `≤ allocated−dispatched` check → `RELEASE` movement → lower allocated_qty → outbox                                                |
| Dispatch      | lock dispatch → status-conditional early return → per line `DISPATCH` movement + bump dispatched_qty → outbox                                             |
| Delivery      | lock dispatch → status-conditional early return → per line delivered_qty (≤ dispatched) + bump delivered_qty → set delivered_at → outbox                  |

## Idempotency & concurrency

- `goods_receipts.idempotency_key` — unique per tenant. Partial unique
  `stock_movements (tenant_id, idempotency_key)`. Allocation/release/adjust/
  transfer accept an optional `idempotencyKey`.
- Pattern: **acquire the serializing row lock first, then check the
  idempotency key / status.** A losing concurrent request blocks on the lock
  and, once it proceeds, sees the committed prior state and no-ops instead of
  racing the invariant checks.
- Dispatch/deliver additionally use status-conditional early return
  (`if DISPATCHED/DELIVERED return`).
- Covered by real concurrent-request integration tests
  (`apps/api/test/supply.int.spec.ts`): duplicate goods receipt, duplicate
  allocation, duplicate dispatch.

## Permissions (added to the single catalogue in `@aivoryx/shared`)

```
projects.read / create / update / approve
products.read / create / update
suppliers.read / create / update
warehouses.read / create / update
inventory.read / adjust / allocate / transfer
procurement.read / create / update / approve / receive
dispatch.read / create / update / dispatch / deliver
```

`TENANT_ADMIN` holds all 26 through the existing "admin holds the whole
catalogue" mechanism. `FIELD_AGENT` holds none — the field PWA is not an
inventory app. No role-creation API.

## API (`/api/v1`)

```
Projects
  GET    /projects                              projects.read
  GET    /projects/:id                           projects.read
  GET    /projects/:id/activities                projects.read
  POST   /projects                               projects.create
  POST   /projects/:id/approve                   projects.approve
  POST   /projects/:id/status                    projects.update
  POST   /projects/:id/materials                 projects.update
  PATCH  /projects/:id/materials/:materialId     projects.update
  DELETE /projects/:id/materials/:materialId     projects.update
  POST   /projects/:id/materials/allocate        inventory.allocate
  POST   /projects/:id/materials/release         inventory.allocate

Catalog
  GET/POST   /inventory/units                    products.read / products.create
  GET/POST   /inventory/categories               products.read / products.create
  GET        /inventory/products[/:id]           products.read
  POST       /inventory/products                 products.create
  PATCH      /inventory/products/:id             products.update
  GET        /inventory/suppliers[/:id]          suppliers.read
  POST       /inventory/suppliers                suppliers.create
  PATCH      /inventory/suppliers/:id            suppliers.update
  GET        /inventory/warehouses[/:id]         warehouses.read
  POST       /inventory/warehouses               warehouses.create
  PATCH      /inventory/warehouses/:id           warehouses.update

Inventory
  GET    /inventory/stock                        inventory.read
  GET    /inventory/movements                    inventory.read
  GET    /inventory/warehouses/:id/stock         inventory.read
  POST   /inventory/adjustments                  inventory.adjust
  POST   /inventory/transfers                    inventory.transfer

Procurement
  GET    /procurement/purchase-orders[/:id]      procurement.read
  POST   /procurement/purchase-orders            procurement.create
  PATCH  /procurement/purchase-orders/:id        procurement.update
  POST   /procurement/purchase-orders/:id/submit procurement.update
  POST   /procurement/purchase-orders/:id/approve procurement.approve
  POST   /procurement/purchase-orders/:id/cancel procurement.update
  POST   /procurement/purchase-orders/:id/close  procurement.update
  POST   /procurement/purchase-orders/:id/receive procurement.receive

Logistics
  GET    /logistics/dispatches[/:id]             dispatch.read
  POST   /logistics/dispatches                   dispatch.create
  PATCH  /logistics/dispatches/:id               dispatch.update
  POST   /logistics/dispatches/:id/cancel        dispatch.update
  POST   /logistics/dispatches/:id/dispatch      dispatch.dispatch
  POST   /logistics/dispatches/:id/deliver       dispatch.deliver
  GET    /logistics/dispatches/:id/attachments   dispatch.read
  POST   /logistics/dispatches/:id/attachments   dispatch.deliver
  GET    /logistics/dispatches/:id/attachments/:attachmentId/download   dispatch.read
  DELETE /logistics/dispatches/:id/attachments/:attachmentId            dispatch.deliver
```

Every protected route derives tenant + actor user + actor membership from the
authenticated security context. Tenant ownership is never accepted from the
client. Unbounded lists (`projects`, `products`, `stock`, `movements`,
`purchase-orders`, `dispatches`) are paginated.

## Stable error codes

`INSUFFICIENT_STOCK`, `NEGATIVE_STOCK_NOT_ALLOWED`,
`ALLOCATION_EXCEEDS_AVAILABLE_STOCK`, `ALLOCATION_EXCEEDS_REQUIREMENT`,
`RELEASE_EXCEEDS_ALLOCATED`, `PO_INVALID_TRANSITION`, `PO_NOT_APPROVED`,
`PO_OVER_RECEIPT`, `PROJECT_INVALID_TRANSITION`, `DISPATCH_INVALID_STATE`,
`DISPATCH_EXCEEDS_ALLOCATED`, `DELIVERY_INVALID_STATE`,
`DELIVERY_EXCEEDS_DISPATCHED`, `TRANSFER_SAME_WAREHOUSE`, `DUPLICATE_CODE`,
plus the shared `*_NOT_FOUND` / `ATTACHMENT_*` codes. All returned inside the
standard HTTP error envelope with a correlation id.

## Internal events (existing outbox, ADR 0013)

`project.created/approved`, `purchase_order.created/approved/received`,
`inventory.received/allocated/released/adjusted/transferred`,
`dispatch.created/dispatched/delivered` — each emitted in the same
transaction as its state change. No new event mechanism.

## Web UI

`/projects`, `/projects/:id` (Required/Allocated/Dispatched/Delivered/
Remaining per material, allocate/release inline, timeline),
`/inventory/{products,suppliers,warehouses,stock}` (stock shows on-hand /
reserved / available + low-stock, adjust + transfer, movement ledger),
`/procurement/purchase-orders[/:id]` (raise, submit, approve, receive with
partial quantities), `/logistics/dispatches[/:id]` (create from allocated
stock, dispatch, confirm delivery with a photo/PDF). The CRM lead detail page
shows the linked project, its operational status, and material readiness.
Field agents are not routed here.

## Demo / seed

`pnpm --filter @aivoryx/api seed:supply-demo` — idempotent, layered onto the
same `clans-demo` tenant as the Phase 4 field demo. Seeds a TENANT_ADMIN,
units, categories, solar-flavoured (but generically-modelled) products, two
suppliers, two warehouses, opening stock, a demo lead, an APPROVED project
with material requirements, and an APPROVED purchase order ready to receive.
The local demo password is printed by the script and is not a production
secret.

## Strictly out of scope this phase

Zoho Inventory/Books, accounting, invoices, payments, GST accounting engine,
quotation builder, customer payment tracking, route optimization,
fleet/driver management, barcode hardware, advanced warehouse/bin management,
serial-number tracking, batch/lot tracking, demand forecasting, automated
purchasing, AI procurement, a workflow engine, HR/payroll, solar design/BOQ,
native mobile, microservices, and true offline-first sync.
