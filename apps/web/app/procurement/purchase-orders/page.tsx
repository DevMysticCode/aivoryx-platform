'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import {
  useCreatePurchaseOrder,
  useProducts,
  useProjects,
  usePurchaseOrders,
  useSuppliers,
} from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import {
  fmtDate,
  fmtMoney,
  FormDisclosure,
  JumpToFormButton,
  Pager,
  Select,
  SupplyStatusBadge,
  Table,
  Toolbar,
} from '@/components/supply/ui';

const STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
];

interface DraftLine {
  productId: string;
  orderedQty: string;
  unitPrice: string;
  taxRate: string;
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('procurement.create');

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [rawQuery, setRawQuery] = useState('');
  const q = useDebounced(rawQuery.trim(), 250);
  useEffect(() => setPage(1), [q, status]);
  const pos = usePurchaseOrders({ status: status || undefined, q: q || undefined, page, pageSize });
  const totalPages = pos.data ? Math.max(1, Math.ceil(pos.data.total / pageSize)) : 1;

  const suppliers = useSuppliers();
  const projects = useProjects({ pageSize: 100 });
  const products = useProducts({ isActive: true, pageSize: 100 });
  const createPo = useCreatePurchaseOrder();

  const [supplierId, setSupplierId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { productId: '', orderedQty: '', unitPrice: '', taxRate: '' },
  ]);

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validLines = lines.filter((l) => l.productId && l.orderedQty);
    if (!supplierId || validLines.length === 0) return;
    const po = await createPo.mutateAsync({
      supplierId,
      projectId: projectId || undefined,
      lines: validLines.map((l) => ({
        productId: l.productId,
        orderedQty: l.orderedQty,
        unitPrice: l.unitPrice || undefined,
        taxRate: l.taxRate || undefined,
      })),
    });
    setSupplierId('');
    setProjectId('');
    setLines([{ productId: '', orderedQty: '', unitPrice: '', taxRate: '' }]);
    router.push(`/procurement/purchase-orders/${po.id}`);
  };

  return (
    <section className="space-y-6">
      <PageHeader
        title="Purchase orders"
        description="Raise, approve and receive supplier orders. Receiving posts stock automatically."
      >
        {canCreate ? (
          <JumpToFormButton targetId="new-purchase-order">New purchase order</JumpToFormButton>
        ) : null}
      </PageHeader>

      {canCreate ? (
        <FormDisclosure id="new-purchase-order">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">New purchase order</h2>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Supplier"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Select supplier…</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Project (optional)"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">None</option>
                  {(projects.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">Lines</span>
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className="grid gap-2 sm:grid-cols-[1fr_100px_110px_90px_auto] sm:items-center"
                  >
                    <Select
                      value={l.productId}
                      onChange={(e) => setLine(i, { productId: e.target.value })}
                    >
                      <option value="">Product…</option>
                      {(products.data?.items ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </Select>
                    <input
                      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                      placeholder="Qty"
                      inputMode="decimal"
                      value={l.orderedQty}
                      onChange={(e) => setLine(i, { orderedQty: e.target.value })}
                    />
                    <input
                      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                      placeholder="Unit price"
                      inputMode="decimal"
                      value={l.unitPrice}
                      onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                    />
                    <input
                      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                      placeholder="Tax %"
                      inputMode="decimal"
                      value={l.taxRate}
                      onChange={(e) => setLine(i, { taxRate: e.target.value })}
                    />
                    <button
                      type="button"
                      className="text-xs text-danger hover:underline disabled:opacity-40"
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setLines((ls) => [
                      ...ls,
                      { productId: '', orderedQty: '', unitPrice: '', taxRate: '' },
                    ])
                  }
                >
                  + Add line
                </button>
              </div>

              <Button type="submit" disabled={createPo.isPending || !supplierId}>
                {createPo.isPending ? 'Creating…' : 'Create purchase order'}
              </Button>
            </form>
            <ErrorNote error={createPo.error} />
          </Card>
        </FormDisclosure>
      ) : null}

      <Toolbar count={pos.data ? `${pos.data.total} order(s)` : undefined}>
        <label className="relative">
          <span className="mb-1.5 block text-sm font-medium">Search</span>
          <Search className="pointer-events-none absolute left-2.5 top-[34px] size-4 text-muted-foreground" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search PO number, supplier…"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div>
          <Select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>
      </Toolbar>

      {pos.isLoading ? (
        <Skeleton rows={6} />
      ) : pos.error ? (
        <ErrorNote error={pos.error} />
      ) : pos.data && pos.data.items.length > 0 ? (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">PO</th>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            }
          >
            {pos.data.items.map((po) => (
              <tr key={po.id} className="hover:bg-surface-hover">
                <td className="px-3 py-2">
                  <Link
                    href={`/procurement/purchase-orders/${po.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {po.number}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{po.supplierName}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {po.projectNumber ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={po.status} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(po.total)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(po.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      ) : q || status ? (
        <EmptyState title="No purchase orders match these filters">
          Try a different PO number or supplier, or set the status back to all statuses.
        </EmptyState>
      ) : (
        <EmptyState
          title="No purchase orders yet"
          action={
            canCreate ? (
              <JumpToFormButton targetId="new-purchase-order">
                Create a purchase order
              </JumpToFormButton>
            ) : undefined
          }
        >
          A purchase order is a request to a supplier for materials. Approve it, then receive the
          goods to add them to warehouse stock.
        </EmptyState>
      )}
    </section>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
