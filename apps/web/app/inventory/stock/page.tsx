'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  useAdjustStock,
  useMovements,
  useProducts,
  useStock,
  useTransferStock,
  useWarehouses,
} from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import { fmtDate, fmtQty, Pager, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';

export default function StockPage() {
  const perms = usePermissions();
  const canAdjust = perms.includes('inventory.adjust');
  const canTransfer = perms.includes('inventory.transfer');

  const warehouses = useWarehouses();
  const products = useProducts({ isActive: true, pageSize: 100 });

  const [warehouseId, setWarehouseId] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const stock = useStock({
    warehouseId: warehouseId || undefined,
    lowStock: lowStock || undefined,
    page,
    pageSize,
  });
  const movements = useMovements({ warehouseId: warehouseId || undefined, pageSize: 25 });
  const totalPages = stock.data ? Math.max(1, Math.ceil(stock.data.total / pageSize)) : 1;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Stock"
        description="On-hand and reserved quantities per warehouse, derived from the append-only movement ledger."
      />

      {canAdjust || canTransfer ? (
        <div className="grid gap-4 md:grid-cols-2">
          {canAdjust ? (
            <AdjustForm warehouses={warehouses.data ?? []} products={products.data?.items ?? []} />
          ) : null}
          {canTransfer ? (
            <TransferForm
              warehouses={warehouses.data ?? []}
              products={products.data?.items ?? []}
            />
          ) : null}
        </div>
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Warehouse"
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All warehouses</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </Select>
        <label className="flex items-end gap-2 pb-1 text-sm">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(e) => {
              setLowStock(e.target.checked);
              setPage(1);
            }}
          />
          Low stock only
        </label>
        <div className="flex items-end text-sm text-muted-foreground">
          {stock.data ? `${stock.data.total} line(s)` : ''}
        </div>
      </Card>

      {stock.isLoading ? (
        <Skeleton rows={6} />
      ) : stock.error ? (
        <ErrorNote error={stock.error} />
      ) : stock.data && stock.data.items.length > 0 ? (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Warehouse</th>
                <th className="px-3 py-2 text-right font-medium">On hand</th>
                <th className="px-3 py-2 text-right font-medium">Reserved</th>
                <th className="px-3 py-2 text-right font-medium">Available</th>
                <th className="px-3 py-2 font-medium">Reorder</th>
              </tr>
            }
          >
            {stock.data.items.map((s) => (
              <tr key={`${s.warehouseId}-${s.productId}`} className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <div className="font-medium">{s.productName}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.productSku} · {s.unitCode}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{s.warehouseCode}</td>
                <td className="px-3 py-2 text-right">{fmtQty(s.onHand)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{fmtQty(s.reserved)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtQty(s.available)}</td>
                <td className="px-3 py-2">
                  {s.lowStock ? (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      Low ({fmtQty(s.reorderLevel)})
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{fmtQty(s.reorderLevel)}</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      ) : (
        <EmptyState>No stock lines match these filters.</EmptyState>
      )}

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Recent movements</h2>
        {movements.isLoading ? (
          <Skeleton rows={4} />
        ) : movements.data && movements.data.items.length > 0 ? (
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Warehouse</th>
                <th className="px-3 py-2 text-right font-medium">On-hand Δ</th>
                <th className="px-3 py-2 text-right font-medium">Reserved Δ</th>
              </tr>
            }
          >
            {movements.data.items.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(m.createdAt)}</td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={m.type} />
                </td>
                <td className="px-3 py-2 text-xs">{m.productSku}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{m.warehouseCode}</td>
                <td className="px-3 py-2 text-right">{fmtQty(m.onHandDelta)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {fmtQty(m.reservedDelta)}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
        )}
      </Card>
    </section>
  );
}

type WhOpt = { id: string; code: string; name: string };
type ProdOpt = { id: string; sku: string; name: string };

function AdjustForm({ warehouses, products }: { warehouses: WhOpt[]; products: ProdOpt[] }) {
  const adjust = useAdjustStock();
  const [form, setForm] = useState({ warehouseId: '', productId: '', delta: '', reason: '' });

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Adjust stock</h2>
      <p className="text-xs text-muted-foreground">
        Records an ADJUSTMENT movement. Use a signed delta, e.g. <code>-2</code> for shrinkage.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.warehouseId || !form.productId || !form.delta || !form.reason) return;
          await adjust.mutateAsync(form);
          setForm({ warehouseId: '', productId: '', delta: '', reason: '' });
        }}
        className="grid gap-2"
      >
        <Select
          label="Warehouse"
          value={form.warehouseId}
          onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
        >
          <option value="">Select…</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </Select>
        <Select
          label="Product"
          value={form.productId}
          onChange={(e) => setForm({ ...form, productId: e.target.value })}
        >
          <option value="">Select…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} — {p.name}
            </option>
          ))}
        </Select>
        <Field
          label="Delta"
          inputMode="decimal"
          value={form.delta}
          onChange={(e) => setForm({ ...form, delta: e.target.value })}
        />
        <Field
          label="Reason"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <Button type="submit" disabled={adjust.isPending}>
          {adjust.isPending ? 'Saving…' : 'Apply adjustment'}
        </Button>
      </form>
      <ErrorNote error={adjust.error} />
    </Card>
  );
}

function TransferForm({ warehouses, products }: { warehouses: WhOpt[]; products: ProdOpt[] }) {
  const transfer = useTransferStock();
  const [form, setForm] = useState({
    sourceWarehouseId: '',
    destinationWarehouseId: '',
    productId: '',
    quantity: '',
  });

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Transfer stock</h2>
      <p className="text-xs text-muted-foreground">
        Moves on-hand quantity between two warehouses atomically.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            !form.sourceWarehouseId ||
            !form.destinationWarehouseId ||
            !form.productId ||
            !form.quantity
          )
            return;
          await transfer.mutateAsync(form);
          setForm({
            sourceWarehouseId: '',
            destinationWarehouseId: '',
            productId: '',
            quantity: '',
          });
        }}
        className="grid gap-2"
      >
        <Select
          label="From"
          value={form.sourceWarehouseId}
          onChange={(e) => setForm({ ...form, sourceWarehouseId: e.target.value })}
        >
          <option value="">Select…</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </Select>
        <Select
          label="To"
          value={form.destinationWarehouseId}
          onChange={(e) => setForm({ ...form, destinationWarehouseId: e.target.value })}
        >
          <option value="">Select…</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </Select>
        <Select
          label="Product"
          value={form.productId}
          onChange={(e) => setForm({ ...form, productId: e.target.value })}
        >
          <option value="">Select…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} — {p.name}
            </option>
          ))}
        </Select>
        <Field
          label="Quantity"
          inputMode="decimal"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />
        <Button type="submit" disabled={transfer.isPending}>
          {transfer.isPending ? 'Transferring…' : 'Transfer'}
        </Button>
      </form>
      <ErrorNote error={transfer.error} />
    </Card>
  );
}
