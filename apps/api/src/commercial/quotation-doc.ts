import type { QuotationDetailDto } from './commercial.dto.js';

/**
 * A self-contained, print-friendly quotation document (Phase 6, ADR 0035).
 *
 * V1 is deliberately server-rendered HTML with inline print CSS — no PDF
 * toolchain. The browser's own "Print → Save as PDF" is sufficient. The
 * rendering is isolated here so a real server-side PDF generator can be added
 * later without touching the service or the API.
 */

interface PrintCustomer {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
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

export function renderQuotationHtml(input: {
  workspaceName: string;
  quotation: QuotationDetailDto;
  customer: PrintCustomer;
}): string {
  const { workspaceName, quotation: q, customer } = input;
  const rev = q.currentRevision;
  const custLines = [
    customer.addressLine,
    [customer.city, customer.state].filter(Boolean).join(', ') || null,
    customer.taxReference ? `Tax ref: ${customer.taxReference}` : null,
    [customer.phone, customer.email].filter(Boolean).join(' · ') || null,
  ].filter(Boolean);

  const rows = rev.lines
    .map(
      (l, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <div class="desc">${esc(l.description)}</div>
          ${l.productSku ? `<div class="sku">${esc(l.productSku)}</div>` : ''}
        </td>
        <td class="num">${esc(fmtQty(l.quantity))}${l.unitLabel ? ` ${esc(l.unitLabel)}` : ''}</td>
        <td class="num">${fmtMoney(l.unitPrice)}</td>
        <td class="num">${fmtMoney(l.discount)}</td>
        <td class="num">${esc(fmtQty(l.taxRate))}</td>
        <td class="num">${fmtMoney(l.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quotation ${esc(q.number)} (rev ${rev.revisionNo})</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; background: #f5f5f5; }
  .sheet { max-width: 820px; margin: 24px auto; background: #fff; padding: 40px; border: 1px solid #e5e5e5; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 16px; }
  header h1 { margin: 0; font-size: 22px; letter-spacing: .01em; }
  .muted { color: #666; }
  .meta { text-align: right; font-size: 12px; }
  .meta strong { font-size: 15px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eee; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .parties { display: flex; gap: 40px; margin: 24px 0; }
  .parties section { flex: 1; }
  .parties h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #666; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #666; border-bottom: 1px solid #ccc; padding: 8px 6px; }
  td { padding: 8px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .desc { font-weight: 500; }
  .sku { font-size: 11px; color: #888; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { border-top: 2px solid #111; margin-top: 4px; padding-top: 8px; font-weight: 700; font-size: 15px; }
  .notes { margin-top: 28px; white-space: pre-wrap; }
  footer { margin-top: 40px; font-size: 11px; color: #888; border-top: 1px solid #eee; padding-top: 12px; }
  @media print {
    body { background: #fff; }
    .sheet { border: 0; margin: 0; max-width: none; padding: 0; }
    @page { margin: 18mm; }
  }
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div>
      <h1>${esc(workspaceName)}</h1>
      <div class="muted">Quotation</div>
    </div>
    <div class="meta">
      <div><strong>${esc(q.number)}</strong></div>
      <div>Revision ${rev.revisionNo} · <span class="badge">${esc(q.status)}</span></div>
      <div class="muted">Issued: ${fmtDate(rev.issueDate ?? q.createdAt)}</div>
      <div class="muted">Valid until: ${fmtDate(rev.validityDate)}</div>
    </div>
  </header>

  <div class="parties">
    <section>
      <h2>Prepared for</h2>
      <div class="desc">${esc(customer.name)}</div>
      ${custLines.map((l) => `<div class="muted">${esc(l)}</div>`).join('')}
    </section>
    <section>
      <h2>Reference</h2>
      <div class="muted">Lead: ${esc(q.leadName ?? '—')}</div>
      ${q.projectNumber ? `<div class="muted">Project: ${esc(q.projectNumber)}</div>` : ''}
    </section>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="num">Discount</th>
        <th class="num">Tax rate</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="7" class="muted">No line items.</td></tr>'}</tbody>
  </table>

  <div class="totals">
    <div><span class="muted">Subtotal</span><span>${fmtMoney(rev.subtotal)}</span></div>
    <div><span class="muted">Discount</span><span>${fmtMoney(rev.discountTotal)}</span></div>
    <div><span class="muted">Tax</span><span>${fmtMoney(rev.taxTotal)}</span></div>
    <div class="grand"><span>Total</span><span>${fmtMoney(rev.total)}</span></div>
  </div>

  ${rev.notes ? `<div class="notes"><h2 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:0 0 4px">Terms &amp; notes</h2>${esc(rev.notes)}</div>` : ''}

  <footer>
    This quotation is an internal commercial document. It is not an invoice and does not constitute a
    binding contract. Prices are valid until the date shown above.
  </footer>
</div>
</body>
</html>`;
}
