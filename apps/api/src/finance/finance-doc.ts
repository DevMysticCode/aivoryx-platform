import type { InvoiceDetailDto, PaymentDetailDto } from './finance.dto.js';

/**
 * Self-contained, print-friendly finance documents (Phase 9, ADR 0038).
 * Server-rendered HTML with inline print CSS — no PDF toolchain (the browser's
 * "Print → Save as PDF" is enough), mirroring `commercial/quotation-doc.ts`.
 * A real PDF generator can be swapped in here later without touching services.
 */

interface DocParty {
  name?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  taxReference?: string | null;
  phone?: string | null;
  email?: string | null;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(value: string | null | undefined): string {
  if (value == null || value === '') return '0.00';
  const n = Number(value);
  return Number.isNaN(n)
    ? esc(value)
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function addressBlock(p: DocParty | null): string {
  if (!p) return '';
  const lines = [
    p.name,
    p.addressLine,
    [p.city, p.state, p.postalCode].filter(Boolean).join(', '),
    p.country,
  ]
    .filter(Boolean)
    .map((l) => esc(l));
  if (p.taxReference) lines.push(`Tax ref: ${esc(p.taxReference)}`);
  if (p.phone) lines.push(esc(p.phone));
  if (p.email) lines.push(esc(p.email));
  return lines.join('<br>');
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .muted { color: #666; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .col { flex: 1; }
  .meta { margin: 20px 0; }
  .meta div { margin: 1px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 7px 8px; text-align: left; border-bottom: 1px solid #e5e5e5; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-left: auto; width: 280px; }
  .totals td { border: none; padding: 3px 8px; }
  .totals tr.grand td { border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 15px; padding-top: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #eef; color: #225; }
  .notes { margin-top: 20px; white-space: pre-wrap; }
  @media print { body { padding: 0; } .wrap { max-width: none; } }
`;

function page(title: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

export function renderInvoiceDoc(
  inv: InvoiceDetailDto,
  ctx: { businessName: string; customer: DocParty | null },
): string {
  const lineRows = inv.lines
    .map(
      (l) => `<tr>
        <td>${esc(l.description)}${l.reference ? `<br><span class="muted">${esc(l.reference)}</span>` : ''}</td>
        <td class="num">${esc(fmtQty(l.quantity))}${l.unitLabel ? ` ${esc(l.unitLabel)}` : ''}</td>
        <td class="num">${fmtMoney(l.unitPrice)}</td>
        <td class="num">${fmtMoney(l.lineDiscount)}</td>
        <td class="num">${l.taxName ? `${esc(l.taxName)} ` : ''}${fmtMoney(l.lineTax)}</td>
        <td class="num">${fmtMoney(l.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const inner = `
    <div class="row">
      <div class="col"><h1>Invoice</h1><div class="muted">${esc(inv.number)}</div>
        <div style="margin-top:8px"><span class="badge">${esc(inv.status)}</span>${inv.overdue ? ` <span class="badge" style="background:#fee;color:#922">Overdue ${inv.daysOverdue}d</span>` : ''}</div>
      </div>
      <div class="col" style="text-align:right"><strong>${esc(ctx.businessName)}</strong></div>
    </div>
    <div class="row meta">
      <div class="col"><div class="muted">Billed to</div>${addressBlock(ctx.customer)}</div>
      <div class="col" style="text-align:right">
        <div><span class="muted">Issue date</span> ${fmtDate(inv.issueDate)}</div>
        <div><span class="muted">Due date</span> ${fmtDate(inv.dueDate)}</div>
        <div><span class="muted">Currency</span> ${esc(inv.currency)}</div>
        ${inv.reference ? `<div><span class="muted">Reference</span> ${esc(inv.reference)}</div>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Discount</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${fmtMoney(inv.subtotal)}</td></tr>
      <tr><td>Discount</td><td class="num">-${fmtMoney(inv.discountTotal)}</td></tr>
      <tr><td>Tax</td><td class="num">${fmtMoney(inv.taxTotal)}</td></tr>
      <tr class="grand"><td>Grand total</td><td class="num">${fmtMoney(inv.grandTotal)}</td></tr>
      <tr><td>Paid</td><td class="num">${fmtMoney(inv.amountPaid)}</td></tr>
      ${Number(inv.amountCredited) > 0 ? `<tr><td>Credited</td><td class="num">${fmtMoney(inv.amountCredited)}</td></tr>` : ''}
      <tr class="grand"><td>Outstanding</td><td class="num">${fmtMoney(inv.amountOutstanding)}</td></tr>
    </table>
    ${
      inv.allocations.filter((a) => !a.reversed).length > 0
        ? `<div class="muted" style="margin-top:16px">Payments</div><table><thead><tr><th>Payment</th><th class="num">Amount</th><th>Date</th></tr></thead><tbody>${inv.allocations
            .filter((a) => !a.reversed)
            .map(
              (a) =>
                `<tr><td>${esc(a.paymentNumber)}</td><td class="num">${fmtMoney(a.amount)}</td><td>${fmtDate(a.createdAt)}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : ''
    }
    ${inv.notes ? `<div class="notes"><div class="muted">Notes</div>${esc(inv.notes)}</div>` : ''}
  `;
  return page(`Invoice ${inv.number}`, inner);
}

export function renderReceiptDoc(
  pay: PaymentDetailDto,
  ctx: { businessName: string; customer: DocParty | null },
): string {
  const allocRows = pay.allocations
    .filter((a) => !a.reversed)
    .map(
      (a) => `<tr><td>${esc(a.invoiceNumber)}</td><td class="num">${fmtMoney(a.amount)}</td></tr>`,
    )
    .join('');
  const inner = `
    <div class="row">
      <div class="col"><h1>Payment receipt</h1><div class="muted">${esc(pay.number)}</div>
        <div style="margin-top:8px"><span class="badge">${esc(pay.status)}</span></div>
      </div>
      <div class="col" style="text-align:right"><strong>${esc(ctx.businessName)}</strong></div>
    </div>
    <div class="row meta">
      <div class="col"><div class="muted">Received from</div>${addressBlock(ctx.customer)}</div>
      <div class="col" style="text-align:right">
        <div><span class="muted">Payment date</span> ${fmtDate(pay.paymentDate)}</div>
        <div><span class="muted">Method</span> ${esc(pay.method)}</div>
        <div><span class="muted">Currency</span> ${esc(pay.currency)}</div>
        ${pay.reference ? `<div><span class="muted">Reference</span> ${esc(pay.reference)}</div>` : ''}
      </div>
    </div>
    <table class="totals">
      <tr class="grand"><td>Amount received</td><td class="num">${fmtMoney(pay.amount)}</td></tr>
      <tr><td>Allocated</td><td class="num">${fmtMoney(pay.allocatedAmount)}</td></tr>
      <tr><td>Unallocated</td><td class="num">${fmtMoney(pay.unallocatedAmount)}</td></tr>
    </table>
    ${
      allocRows
        ? `<div class="muted" style="margin-top:16px">Applied to</div><table><thead><tr><th>Invoice</th><th class="num">Amount</th></tr></thead><tbody>${allocRows}</tbody></table>`
        : ''
    }
    ${pay.notes ? `<div class="notes"><div class="muted">Notes</div>${esc(pay.notes)}</div>` : ''}
  `;
  return page(`Receipt ${pay.number}`, inner);
}
