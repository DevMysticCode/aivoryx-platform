'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { fetchDispatchAttachmentBlob } from '@/lib/api/supply';
import {
  useDeleteDispatchAttachment,
  useDispatch,
  useDispatchActions,
  useDispatchAttachments,
  useUploadDispatchAttachment,
} from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Skeleton } from '@/components/admin/ui';
import { fmtDate, fmtQty, SupplyStatusBadge, Table } from '@/components/supply/ui';

export default function DispatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const canUpdate = perms.includes('dispatch.update');
  const canSend = perms.includes('dispatch.dispatch');
  const canDeliver = perms.includes('dispatch.deliver');

  const dispatch = useDispatch(id);
  const { cancel, send, deliver } = useDispatchActions(id);

  if (dispatch.isLoading) return <Skeleton rows={8} />;
  if (dispatch.error) return <ErrorNote error={dispatch.error} />;
  if (!dispatch.data) return <EmptyState>Dispatch not found.</EmptyState>;

  const d = dispatch.data;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{d.number}</h1>
            <SupplyStatusBadge status={d.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/projects/${d.projectId}`} className="text-primary hover:underline">
              {d.projectNumber}
            </Link>{' '}
            · from {d.warehouseName}
          </p>
          {d.destinationAddress ? (
            <p className="text-xs text-muted-foreground">To: {d.destinationAddress}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {d.status === 'DRAFT' && canSend ? (
            <Button onClick={() => send.mutate()} disabled={send.isPending}>
              {send.isPending ? 'Dispatching…' : 'Mark dispatched'}
            </Button>
          ) : null}
          {d.status === 'DRAFT' && canUpdate ? (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorNote error={send.error || cancel.error} />

      <Card className="space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted-foreground">
          <span>
            Dispatched: <span className="text-foreground">{fmtDate(d.dispatchedAt)}</span>
          </span>
          <span>
            Delivered: <span className="text-foreground">{fmtDate(d.deliveredAt)}</span>
          </span>
        </div>
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="px-3 py-2 text-right font-medium">Delivered</th>
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
              <td className="px-3 py-2 text-right">{fmtQty(l.quantity)}</td>
              <td className="px-3 py-2 text-right">{fmtQty(l.deliveredQty)}</td>
            </tr>
          ))}
        </Table>
        {d.deliveryNotes ? (
          <p className="text-sm">
            <span className="font-medium">Delivery notes:</span> {d.deliveryNotes}
          </p>
        ) : null}
      </Card>

      {d.status === 'DISPATCHED' && canDeliver ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Confirm delivery</h2>
          <DeliverForm
            lines={d.lines}
            pending={deliver.isPending}
            error={deliver.error}
            onSubmit={(body) => deliver.mutate(body)}
          />
        </Card>
      ) : null}

      <Attachments dispatchId={id} canManage={canDeliver} />
    </section>
  );
}

function DeliverForm({
  lines,
  pending,
  error,
  onSubmit,
}: {
  lines: { id: string; productName: string; quantity: string }[];
  pending: boolean;
  error: unknown;
  onSubmit: (body: {
    deliveryNotes?: string;
    lines?: { dispatchLineId: string; deliveredQty: string }[];
  }) => void;
}) {
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.quantity])),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          deliveryNotes: notes || undefined,
          lines: lines.map((l) => ({
            dispatchLineId: l.id,
            deliveredQty: qty[l.id] ?? l.quantity,
          })),
        });
      }}
      className="space-y-3"
    >
      <Table
        head={
          <tr>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">Dispatched</th>
            <th className="px-3 py-2 text-right font-medium">Delivered qty</th>
          </tr>
        }
      >
        {lines.map((l) => (
          <tr key={l.id}>
            <td className="px-3 py-2 font-medium">{l.productName}</td>
            <td className="px-3 py-2 text-right">{fmtQty(l.quantity)}</td>
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
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Delivery notes (optional)</span>
        <textarea
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? 'Confirming…' : 'Confirm delivery'}
      </Button>
      <ErrorNote error={error} />
    </form>
  );
}

function Attachments({ dispatchId, canManage }: { dispatchId: string; canManage: boolean }) {
  const attachments = useDispatchAttachments(dispatchId);
  const upload = useUploadDispatchAttachment(dispatchId);
  const remove = useDeleteDispatchAttachment(dispatchId);
  const [busy, setBusy] = useState(false);

  const view = async (attachmentId: string) => {
    const { objectUrl } = await fetchDispatchAttachmentBlob(dispatchId, attachmentId);
    window.open(objectUrl, '_blank', 'noopener');
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Delivery attachments</h2>
      {attachments.isLoading ? (
        <Skeleton rows={2} />
      ) : attachments.data && attachments.data.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {attachments.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => view(a.id)}
              >
                {a.originalFilename ?? a.id.slice(0, 8)}
              </button>
              <span className="text-xs text-muted-foreground">
                {(a.fileSize / 1024).toFixed(0)} KB
                {canManage ? (
                  <button
                    type="button"
                    className="ml-3 text-destructive hover:underline"
                    onClick={() => remove.mutate(a.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No attachments.</p>
      )}
      {canManage ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                await upload.mutateAsync(file);
              } finally {
                setBusy(false);
                e.target.value = '';
              }
            }}
          />
          {busy ? 'Uploading…' : '+ Upload photo or PDF'}
        </label>
      ) : null}
      <ErrorNote error={upload.error || remove.error} />
    </Card>
  );
}
