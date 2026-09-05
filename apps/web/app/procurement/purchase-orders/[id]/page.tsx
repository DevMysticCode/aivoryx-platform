'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  usePoTransition,
  usePurchaseOrder,
  useReceivePurchaseOrder,
  useWarehouses,
} from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Skeleton } from '@/components/admin/ui';
import {
  fmtDate,
  fmtMoney,
  fmtQty,
  Select,
  SupplyStatusBadge,
  Table,
} from '@/components/supply/ui';

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const canUpdate = perms.includes('procurement.update');
  const canApprove = perms.includes('procurement.approve');
  const canReceive = perms.includes('procurement.receive');

  const po = usePurchaseOrder(id);
  const { submit, approve, cancel } = usePoTransition(id);

  if (po.isLoading) return <Skeleton rows={8} />;
  if (po.error) return <ErrorNote error={po.error} />;
  if (!po.data) return <EmptyState>Purchase order not found.</EmptyState>;

  const d = po.data;
  const canReceiveNow = d.status === 'APPROVED' || d.status === 'PARTIALLY_RECEIVED';

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{d.number}</h1>
            <SupplyStatusBadge status={d.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {d.supplierName}
            {d.projectNumber ? (
              <>
                {' · '}
                <Link
                  href={d.projectId ? `/projects/${d.projectId}` : '#'}
                  className="text-primary hover:underline"
                >
                  {d.projectNumber}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.status === 'DRAFT' && canUpdate ? (
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              Submit
            </Button>
          ) : null}
          {d.status === 'SUBMITTED' && canApprove ? (
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              Approve
            </Button>
          ) : null}
          {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(d.status) && canUpdate ? (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorNote error={submit.error || approve.error || cancel.error} />

      <Card className="space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Order date: <span className="text-foreground">{fmtDate(d.orderDate)}</span>
          </span>
          <span className="text-muted-foreground">
            Expected: <span className="text-foreground">{fmtDate(d.expectedDate)}</span>
          </span>
          <span className="text-muted-foreground">
            Approved: <span className="text-foreground">{fmtDate(d.approvedAt)}</span>
          </span>
        </div>
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Ordered</th>
              <th className="px-3 py-2 text-right font-medium">Received</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">Tax</th>
              <th className="px-3 py-2 text-right font-medium">Line total</th>
            </tr>
          }
        >
          {d.lines.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2 text-muted-foreground">{l.lineNo}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{l.productName}</div>
                <div className="text-xs text-muted-foreground">{l.productSku}</div>
              </td>
              <td className="px-3 py-2 text-right">{fmtQty(l.orderedQty)}</td>
              <td className="px-3 py-2 text-right">{fmtQty(l.receivedQty)}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {fmtMoney(l.unitPrice)}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">{fmtQty(l.taxRate)}</td>
              <td className="px-3 py-2 text-right">{fmtMoney(l.lineTotal)}</td>
            </tr>
          ))}
        </Table>
        <div className="flex flex-wrap justify-end gap-x-8 gap-y-1 text-sm">
          <span className="text-muted-foreground">Subtotal: {fmtMoney(d.subtotal)}</span>
          <span className="text-muted-foreground">Tax: {fmtMoney(d.taxTotal)}</span>
          <span className="text-muted-foreground">Discount: {fmtMoney(d.discountTotal)}</span>
          <span className="font-semibold">Total: {fmtMoney(d.total)}</span>
        </div>
      </Card>

      {canReceive && canReceiveNow ? <ReceiveForm poId={id} lines={d.lines} /> : null}

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Goods receipts</h2>
        {d.receipts.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {d.receipts.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-4">
                <span>
                  <span className="font-medium">{r.number}</span> · {r.warehouseName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.receivedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing received yet.</p>
        )}
      </Card>
    </section>
  );
}

function ReceiveForm({
  poId,
  lines,
}: {
  poId: string;
  lines: {
    id: string;
    productName: string;
    productSku: string;
    orderedQty: string;
    receivedQty: string;
  }[];
}) {
  const warehouses = useWarehouses();
  const receive = useReceivePurchaseOrder(poId);
  const [warehouseId, setWarehouseId] = useState('');
  const outstanding = useMemo(
    () =>
      lines.map((l) => ({
        ...l,
        remaining: (Number(l.orderedQty) - Number(l.receivedQty)).toString(),
      })),
    [lines],
  );
  const [qty, setQty] = useState<Record<string, string>>({});

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Receive goods</h2>
      <p className="text-xs text-muted-foreground">
        Posts a stock RECEIPT into the chosen warehouse and updates received quantities atomically.
        Partial receipts are allowed; over-receipt is rejected.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const receiptLines = Object.entries(qty)
            .filter(([, v]) => v && Number(v) > 0)
            .map(([purchaseOrderLineId, receivedQty]) => ({ purchaseOrderLineId, receivedQty }));
          if (!warehouseId || receiptLines.length === 0) return;
          await receive.mutateAsync({ warehouseId, lines: receiptLines });
          setQty({});
        }}
        className="space-y-3"
      >
        <Select
          label="Warehouse"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">Select warehouse…</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </Select>
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Remaining</th>
              <th className="px-3 py-2 text-right font-medium">Receive now</th>
            </tr>
          }
        >
          {outstanding.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2">
                <div className="font-medium">{l.productName}</div>
                <div className="text-xs text-muted-foreground">{l.productSku}</div>
              </td>
              <td className="px-3 py-2 text-right">{fmtQty(l.remaining)}</td>
              <td className="px-3 py-2 text-right">
                <input
                  className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-right text-sm"
                  inputMode="decimal"
                  value={qty[l.id] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </Table>
        <Button type="submit" disabled={receive.isPending || !warehouseId}>
          {receive.isPending ? 'Receiving…' : 'Confirm receipt'}
        </Button>
      </form>
      <ErrorNote error={receive.error} />
    </Card>
  );
}
