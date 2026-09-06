'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@aivoryx/ui';
import type { QuotationLineInput } from '@aivoryx/contracts';
import {
  quotationPdfUrl,
  quotationPrintUrl,
  fetchQuotationAttachmentBlob,
} from '@/lib/api/commercial';
import { useProducts } from '@/lib/supply/use-supply';
import {
  useDeleteQuotationAttachment,
  useQuotation,
  useQuotationActions,
  useQuotationActivities,
  useQuotationAttachments,
  useUpdateQuotation,
  useUploadQuotationAttachment,
} from '@/lib/commercial/use-commercial';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Skeleton } from '@/components/admin/ui';
import { fmtDate, fmtMoney, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';

interface DraftLine {
  productId: string;
  description: string;
  unitLabel: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
}

const emptyLine = (): DraftLine => ({
  productId: '',
  description: '',
  unitLabel: '',
  quantity: '1',
  unitPrice: '0',
  discount: '0',
  taxRate: '0',
});

/** Client-side preview only — the server is the source of truth on save. */
function previewTotals(lines: DraftLine[]) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = round2((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0));
    const disc = round2(Number(l.discount) || 0);
    const net = Math.max(0, gross - disc);
    const t = round2(net * (Number(l.taxRate) || 0));
    subtotal += gross;
    discount += disc;
    tax += t;
  }
  return {
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    tax: tax.toFixed(2),
    total: (subtotal - discount + tax).toFixed(2),
  };
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const can = (p: string) => perms.includes(p);

  const quotation = useQuotation(id);
  const activities = useQuotationActivities(id);
  const actions = useQuotationActions(id);
  const update = useUpdateQuotation(id);
  const products = useProducts({ isActive: true, pageSize: 100 });

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [validityDate, setValidityDate] = useState('');
  const [acceptNote, setAcceptNote] = useState('');

  const preview = useMemo(() => previewTotals(lines), [lines]);

  if (quotation.isLoading) return <Skeleton rows={8} />;
  if (quotation.error) return <ErrorNote error={quotation.error} />;
  if (!quotation.data) return <EmptyState>Quotation not found.</EmptyState>;

  const qd = quotation.data;
  const rev = qd.currentRevision;
  const isDraft = qd.status === 'DRAFT';

  const startEdit = () => {
    setLines(
      rev.lines.length
        ? rev.lines.map((l) => ({
            productId: l.productId ?? '',
            description: l.description,
            unitLabel: l.unitLabel ?? '',
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount,
            taxRate: l.taxRate,
          }))
        : [emptyLine()],
    );
    setNotes(rev.notes ?? '');
    setValidityDate(rev.validityDate ? rev.validityDate.slice(0, 10) : '');
    setEditing(true);
  };

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    const payloadLines: QuotationLineInput[] = lines
      .filter((l) => l.productId || l.description.trim())
      .map((l) => ({
        productId: l.productId || undefined,
        description: l.description.trim() || undefined,
        unitLabel: l.unitLabel || undefined,
        quantity: l.quantity || '0',
        unitPrice: l.unitPrice || '0',
        discount: l.discount || undefined,
        taxRate: l.taxRate || undefined,
      }));
    await update.mutateAsync({
      lines: payloadLines,
      notes: notes || undefined,
      validityDate: validityDate ? new Date(validityDate).toISOString() : undefined,
    });
    setEditing(false);
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{qd.number}</h1>
            <SupplyStatusBadge status={qd.status} />
            <span className="text-xs text-muted-foreground">revision {qd.currentRevisionNo}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {qd.customerId ? (
              <Link href={`/customers/${qd.customerId}`} className="text-primary hover:underline">
                {qd.customerName}
              </Link>
            ) : (
              (qd.leadName ?? 'Lead')
            )}
            {' · '}
            <Link href={`/crm/leads/${qd.leadId}`} className="text-primary hover:underline">
              CRM lead
            </Link>
            {qd.projectId ? (
              <>
                {' · '}
                <Link href={`/projects/${qd.projectId}`} className="text-primary hover:underline">
                  {qd.projectNumber}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={quotationPrintUrl(id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
          >
            Print
          </a>
          <a
            href={quotationPdfUrl(id)}
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
          >
            Download PDF
          </a>
          {isDraft && can('quotations.update') && !editing ? (
            <Button variant="outline" onClick={startEdit}>
              Edit lines
            </Button>
          ) : null}
          {isDraft && can('quotations.send') ? (
            <Button onClick={() => actions.send.mutate()} disabled={actions.send.isPending}>
              Send
            </Button>
          ) : null}
          {qd.status === 'SENT' && can('quotations.accept') ? (
            <Button
              onClick={() => actions.accept.mutate({ note: acceptNote || undefined })}
              disabled={actions.accept.isPending}
            >
              Record acceptance
            </Button>
          ) : null}
          {qd.status === 'ACCEPTED' && can('quotations.book') ? (
            <Button onClick={() => actions.book.mutate()} disabled={actions.book.isPending}>
              {actions.book.isPending ? 'Booking…' : 'Book'}
            </Button>
          ) : null}
          {(qd.status === 'DRAFT' || qd.status === 'SENT') && can('quotations.revise') ? (
            <Button
              variant="outline"
              onClick={() => actions.revise.mutate({})}
              disabled={actions.revise.isPending}
            >
              New revision
            </Button>
          ) : null}
          {(qd.status === 'DRAFT' || qd.status === 'SENT') && can('quotations.cancel') ? (
            <Button
              variant="ghost"
              onClick={() => actions.cancel.mutate()}
              disabled={actions.cancel.isPending}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorNote
        error={
          actions.send.error ||
          actions.accept.error ||
          actions.book.error ||
          actions.revise.error ||
          actions.cancel.error ||
          update.error
        }
      />

      {qd.status === 'SENT' && can('quotations.accept') ? (
        <Card className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1.5">
            <span className="text-sm font-medium">Acceptance note (optional)</span>
            <input
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={acceptNote}
              onChange={(e) => setAcceptNote(e.target.value)}
              placeholder="e.g. Confirmed by customer on call"
            />
          </label>
        </Card>
      ) : null}

      {editing ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Line items</h2>
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-[1.4fr_90px_110px_90px_80px_auto] sm:items-center"
            >
              <div className="space-y-1">
                <Select
                  value={l.productId}
                  onChange={(e) => {
                    const p = products.data?.items.find((x) => x.id === e.target.value);
                    setLine(i, {
                      productId: e.target.value,
                      description: p ? p.name : l.description,
                      unitLabel: p ? p.unitCode : l.unitLabel,
                    });
                  }}
                >
                  <option value="">Custom / service line</option>
                  {(products.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </Select>
                <input
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </div>
              <input
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                placeholder="Qty"
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
              />
              <input
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                placeholder="Unit price"
                inputMode="decimal"
                value={l.unitPrice}
                onChange={(e) => setLine(i, { unitPrice: e.target.value })}
              />
              <input
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                placeholder="Discount"
                inputMode="decimal"
                value={l.discount}
                onChange={(e) => setLine(i, { discount: e.target.value })}
              />
              <input
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                placeholder="Tax rate"
                inputMode="decimal"
                value={l.taxRate}
                onChange={(e) => setLine(i, { taxRate: e.target.value })}
              />
              <button
                type="button"
                className="text-xs text-destructive hover:underline disabled:opacity-40"
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
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
          >
            + Add line
          </button>

          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Valid until</span>
              <input
                type="date"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={validityDate}
                onChange={(e) => setValidityDate(e.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Terms / notes</span>
              <textarea
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
            <span className="text-muted-foreground">
              Preview — subtotal {fmtMoney(preview.subtotal)} · discount{' '}
              {fmtMoney(preview.discount)} · tax {fmtMoney(preview.tax)} ·{' '}
              <span className="font-semibold text-foreground">total {fmtMoney(preview.total)}</span>
            </span>
            <span className="flex gap-2">
              <Button onClick={save} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </span>
          </div>
        </Card>
      ) : (
        <Card className="space-y-3">
          <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted-foreground">
            <span>
              Issued:{' '}
              <span className="text-foreground">{fmtDate(rev.issueDate ?? qd.createdAt)}</span>
            </span>
            <span>
              Valid until: <span className="text-foreground">{fmtDate(rev.validityDate)}</span>
            </span>
            {rev.acceptedAt ? (
              <span>
                Accepted: <span className="text-foreground">{fmtDate(rev.acceptedAt)}</span>
                {rev.acceptedByName ? ` by ${rev.acceptedByName}` : ''}
              </span>
            ) : null}
          </div>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit price</th>
                <th className="px-3 py-2 text-right font-medium">Discount</th>
                <th className="px-3 py-2 text-right font-medium">Tax</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            }
          >
            {rev.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-muted-foreground">{l.lineNo}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{l.description}</div>
                  {l.productSku ? (
                    <div className="text-xs text-muted-foreground">{l.productSku}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Service / custom</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {l.quantity}
                  {l.unitLabel ? ` ${l.unitLabel}` : ''}
                </td>
                <td className="px-3 py-2 text-right">{fmtMoney(l.unitPrice)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {fmtMoney(l.discount)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">{l.taxRate}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </Table>
          <div className="flex flex-wrap justify-end gap-x-8 gap-y-1 text-sm">
            <span className="text-muted-foreground">Subtotal: {fmtMoney(rev.subtotal)}</span>
            <span className="text-muted-foreground">Discount: {fmtMoney(rev.discountTotal)}</span>
            <span className="text-muted-foreground">Tax: {fmtMoney(rev.taxTotal)}</span>
            <span className="font-semibold">Total: {fmtMoney(rev.total)}</span>
          </div>
          {rev.notes ? (
            <p className="border-t pt-3 text-sm">
              <span className="font-medium">Terms:</span> {rev.notes}
            </p>
          ) : null}
        </Card>
      )}

      {qd.revisions.length > 1 ? (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Revisions</h2>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">Revision</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Accepted</th>
              </tr>
            }
          >
            {qd.revisions.map((r) => (
              <tr
                key={r.id}
                className={r.revisionNo === qd.currentRevisionNo ? 'bg-secondary/20' : ''}
              >
                <td className="px-3 py-2 font-medium">rev {r.revisionNo}</td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-right">{fmtMoney(r.total)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(r.sentAt)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(r.acceptedAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      <QuotationAttachments quotationId={id} canManage={can('quotations.update')} />

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Timeline</h2>
        {activities.isLoading ? (
          <Skeleton rows={3} />
        ) : activities.data && activities.data.length > 0 ? (
          <ol className="space-y-2 text-sm">
            {activities.data.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-4">
                <span className="capitalize">{a.type.replace(/_/g, ' ')}</span>
                <span className="text-xs text-muted-foreground">
                  {a.actorName ? `${a.actorName} · ` : ''}
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        )}
      </Card>
    </section>
  );
}

function QuotationAttachments({
  quotationId,
  canManage,
}: {
  quotationId: string;
  canManage: boolean;
}) {
  const attachments = useQuotationAttachments(quotationId);
  const upload = useUploadQuotationAttachment(quotationId);
  const remove = useDeleteQuotationAttachment(quotationId);
  const [busy, setBusy] = useState(false);

  const view = async (attachmentId: string) => {
    const { objectUrl } = await fetchQuotationAttachmentBlob(quotationId, attachmentId);
    window.open(objectUrl, '_blank', 'noopener');
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Attachments</h2>
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
          {busy ? 'Uploading…' : '+ Upload document'}
        </label>
      ) : null}
      <ErrorNote error={upload.error || remove.error} />
    </Card>
  );
}
