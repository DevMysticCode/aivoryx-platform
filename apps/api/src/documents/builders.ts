import type { QuotationDetailDto } from '../commercial/commercial.dto.js';
import type { CreditNoteDto, InvoiceDetailDto, PaymentDetailDto } from '../finance/finance.dto.js';
import type { DocParty, DocTotal, DocumentDefinition } from './document.types.js';

/**
 * Structured-data builders (Phase 10, ADR 0039). Each turns a business DTO into
 * a generic `DocumentDefinition` — layout, branding, header/footer and page
 * numbers are entirely the renderer's job. Amounts are the immutable snapshots
 * already on the DTO; nothing is recomputed here.
 */

function money(v: string | null | undefined, currency?: string): string {
  const n = Number(v ?? 0);
  const s = Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(v ?? '0.00');
  return currency ? `${currency} ${s}` : s;
}

function qty(v: string | null | undefined): string {
  if (v == null || v === '') return '';
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
}

function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function party(heading: string, name: string | null | undefined, extra: string[] = []): DocParty {
  return { heading, lines: [name || '—', ...extra.filter(Boolean)] };
}

// ---- quotation ------------------------------------------------

export function buildQuotationDocument(q: QuotationDetailDto): DocumentDefinition {
  const rev = q.currentRevision;
  return {
    documentTitle: 'Quotation',
    documentNumber: q.number,
    status: q.status,
    meta: [
      { label: 'Quotation no.', value: q.number },
      { label: 'Date', value: date(rev.issueDate ?? rev.createdAt) },
      { label: 'Valid until', value: date(rev.validityDate) },
      { label: 'Revision', value: `#${rev.revisionNo}` },
    ],
    party: party('Prepared for', q.customerName ?? q.leadName),
    table: {
      columns: [
        { key: 'desc', label: 'Description' },
        { key: 'qty', label: 'Qty', align: 'right' },
        { key: 'price', label: 'Unit price', align: 'right' },
        { key: 'disc', label: 'Discount', align: 'right' },
        { key: 'tax', label: 'Tax', align: 'right' },
        { key: 'total', label: 'Amount', align: 'right' },
      ],
      rows: rev.lines.map((l) => ({
        desc: l.description + (l.unitLabel ? ` (${l.unitLabel})` : ''),
        qty: qty(l.quantity),
        price: money(l.unitPrice),
        disc: money(l.discount),
        tax: money(l.lineTax),
        total: money(l.lineTotal),
      })),
    },
    totals: [
      { label: 'Subtotal', value: money(rev.subtotal) },
      { label: 'Discount', value: `-${money(rev.discountTotal)}` },
      { label: 'Tax', value: money(rev.taxTotal) },
      { label: 'Total', value: money(rev.total), emphasis: true },
    ],
    notes: rev.notes,
  };
}

// ---- invoice -------------------------------------------------

export function buildInvoiceDocument(inv: InvoiceDetailDto): DocumentDefinition {
  const activeAllocs = inv.allocations.filter((a) => !a.reversed);
  const totals: DocTotal[] = [
    { label: 'Subtotal', value: money(inv.subtotal) },
    { label: 'Discount', value: `-${money(inv.discountTotal)}` },
    { label: 'Tax', value: money(inv.taxTotal) },
    { label: 'Grand total', value: money(inv.grandTotal, inv.currency), emphasis: true },
    { label: 'Paid', value: money(inv.amountPaid) },
    ...(Number(inv.amountCredited) > 0
      ? [{ label: 'Credited', value: money(inv.amountCredited) }]
      : []),
    { label: 'Outstanding', value: money(inv.amountOutstanding, inv.currency), emphasis: true },
  ];
  return {
    documentTitle: inv.taxTotal && Number(inv.taxTotal) > 0 ? 'Tax Invoice' : 'Invoice',
    documentNumber: inv.number,
    status: inv.overdue ? 'OVERDUE' : inv.status,
    meta: [
      { label: 'Invoice no.', value: inv.number },
      { label: 'Issue date', value: date(inv.issueDate) },
      { label: 'Due date', value: date(inv.dueDate) },
      { label: 'Currency', value: inv.currency },
      ...(inv.reference ? [{ label: 'Reference', value: inv.reference }] : []),
    ],
    party: party('Bill to', inv.customerName),
    table: {
      columns: [
        { key: 'desc', label: 'Description' },
        { key: 'qty', label: 'Qty', align: 'right' },
        { key: 'price', label: 'Unit price', align: 'right' },
        { key: 'disc', label: 'Discount', align: 'right' },
        { key: 'tax', label: 'Tax', align: 'right' },
        { key: 'total', label: 'Amount', align: 'right' },
      ],
      rows: inv.lines.map((l) => ({
        desc: l.description + (l.reference ? `\n${l.reference}` : ''),
        qty: qty(l.quantity),
        price: money(l.unitPrice),
        disc: money(l.lineDiscount),
        tax: (l.taxName ? `${l.taxName} ` : '') + money(l.lineTax),
        total: money(l.lineTotal),
      })),
    },
    totals,
    sections:
      activeAllocs.length > 0
        ? [
            {
              heading: 'Payments received',
              lines: activeAllocs.map(
                (a) =>
                  `${a.paymentNumber} · ${date(a.createdAt)} · ${money(a.amount, inv.currency)}`,
              ),
            },
          ]
        : [],
    notes: inv.notes,
  };
}

// ---- payment receipt --------------------------------------

export function buildReceiptDocument(p: PaymentDetailDto): DocumentDefinition {
  const active = p.allocations.filter((a) => !a.reversed);
  return {
    documentTitle: 'Payment Receipt',
    documentNumber: p.number,
    status: p.status,
    meta: [
      { label: 'Receipt no.', value: p.number },
      { label: 'Payment date', value: date(p.paymentDate) },
      { label: 'Method', value: p.method.replace(/_/g, ' ') },
      { label: 'Currency', value: p.currency },
      ...(p.reference ? [{ label: 'Reference', value: p.reference }] : []),
    ],
    party: party('Received from', p.customerName),
    totals: [
      { label: 'Amount received', value: money(p.amount, p.currency), emphasis: true },
      { label: 'Allocated', value: money(p.allocatedAmount) },
      { label: 'Unallocated', value: money(p.unallocatedAmount) },
    ],
    sections:
      active.length > 0
        ? [
            {
              heading: 'Applied to',
              lines: active.map((a) => `${a.invoiceNumber} · ${money(a.amount, p.currency)}`),
            },
          ]
        : [],
    notes: p.notes,
  };
}

// ---- credit note -----------------------------------------

export function buildCreditNoteDocument(cn: CreditNoteDto): DocumentDefinition {
  return {
    documentTitle: 'Credit Note',
    documentNumber: cn.number,
    status: cn.status,
    meta: [
      { label: 'Credit note no.', value: cn.number },
      { label: 'Issue date', value: date(cn.issueDate) },
      { label: 'Currency', value: cn.currency },
      ...(cn.invoiceNumber ? [{ label: 'Against invoice', value: cn.invoiceNumber }] : []),
    ],
    party: party('Issued to', cn.customerName),
    sections: [{ heading: 'Reason', lines: [cn.reason] }],
    totals: [{ label: 'Credit amount', value: money(cn.amount, cn.currency), emphasis: true }],
    notes: cn.notes,
  };
}
