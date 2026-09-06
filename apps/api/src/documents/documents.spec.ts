import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { QuotationDetailDto } from '../commercial/commercial.dto.js';
import type { InvoiceDetailDto, PaymentDetailDto, CreditNoteDto } from '../finance/finance.dto.js';
import {
  buildCreditNoteDocument,
  buildInvoiceDocument,
  buildQuotationDocument,
  buildReceiptDocument,
} from './builders.js';
import { DocumentPdfService } from './document-pdf.service.js';
import { documentFilename, type DocumentBrandingContext } from './document.types.js';

/**
 * Phase 10 (ADR 0039) — the reusable document engine. Builders map a business
 * DTO to the generic `DocumentDefinition` (no layout, no branding); the PDF
 * service turns that + a branding context into a real, valid PDF. No headless
 * browser is involved — this runs in plain Node.
 */

const invoice: InvoiceDetailDto = {
  id: 'i1',
  number: 'INV-000123',
  customerId: 'c1',
  customerName: 'Blue Sky Ltd',
  projectId: null,
  projectNumber: null,
  quotationId: null,
  source: 'manual',
  status: 'ISSUED',
  currency: 'GBP',
  issueDate: '2026-01-05',
  dueDate: '2026-02-04',
  notes: 'Thank you for your business.',
  reference: 'PO-99',
  subtotal: '1000.00',
  discountTotal: '0.00',
  taxTotal: '200.00',
  grandTotal: '1200.00',
  amountPaid: '200.00',
  amountCredited: '0.00',
  amountOutstanding: '1000.00',
  overdue: false,
  daysOverdue: 0,
  issuedAt: '2026-01-05T00:00:00.000Z',
  createdAt: '2026-01-05T00:00:00.000Z',
  lines: [
    {
      lineNo: 1,
      description: 'Design & supply',
      reference: null,
      productId: null,
      unitLabel: 'kWp',
      quantity: '5',
      unitPrice: '200.00',
      discountType: 'AMOUNT',
      discountValue: '0',
      taxName: 'VAT',
      taxRate: '0.20',
      lineSubtotal: '1000.00',
      lineDiscount: '0.00',
      lineTaxable: '1000.00',
      lineTax: '200.00',
      lineTotal: '1200.00',
    },
  ],
  allocations: [
    {
      id: 'a1',
      paymentId: 'p1',
      paymentNumber: 'PMT-000045',
      invoiceId: 'i1',
      invoiceNumber: 'INV-000123',
      amount: '200.00',
      reversed: false,
      createdAt: '2026-01-10T00:00:00.000Z',
    },
  ],
};

const branding: DocumentBrandingContext = {
  businessName: 'Aurora Renewables',
  addressLines: ['12 Sun Street', 'Leeds, LS1 4DX', 'United Kingdom'],
  taxLine: 'VAT: GB123456789',
  contactLines: ['Email: hello@aurora.example', 'Phone: +44 113 000 0000'],
  primaryColor: '#1e40af',
  documentFooter: 'Payment within 30 days to Aurora Renewables · Sort 00-00-00 · Acc 12345678',
  logo: null,
};

describe('documentFilename', () => {
  it('produces a safe .pdf filename from a document number', () => {
    expect(documentFilename('INV-000123')).toBe('INV-000123.pdf');
    expect(documentFilename('CN/2026 001')).toBe('CN-2026-001.pdf');
    expect(documentFilename('')).toBe('document.pdf');
  });
});

describe('builders map DTOs to a generic definition (no recompute)', () => {
  it('invoice: carries the immutable snapshot amounts through unchanged', () => {
    const def = buildInvoiceDocument(invoice);
    expect(def.documentTitle).toBe('Tax Invoice');
    expect(def.documentNumber).toBe('INV-000123');
    expect(def.table?.rows).toHaveLength(1);
    const total = def.totals?.find((t) => t.label === 'Grand total');
    expect(total?.value).toContain('1,200.00');
    expect(def.totals?.find((t) => t.label === 'Outstanding')?.value).toContain('1,000.00');
    expect(def.sections?.[0]?.heading).toBe('Payments received');
  });

  it('quotation: uses the current revision', () => {
    const quote = {
      number: 'QUO-000009',
      status: 'SENT',
      customerName: 'Blue Sky Ltd',
      leadName: null,
      currentRevision: {
        revisionNo: 2,
        issueDate: '2026-01-02',
        validityDate: '2026-01-31',
        createdAt: '2026-01-02T00:00:00.000Z',
        notes: 'Valid for 30 days.',
        subtotal: '900.00',
        discountTotal: '0.00',
        taxTotal: '0.00',
        total: '900.00',
        lines: [
          {
            description: 'Panels',
            unitLabel: 'unit',
            quantity: '10',
            unitPrice: '90.00',
            discount: '0.00',
            lineTax: '0.00',
            lineTotal: '900.00',
          },
        ],
      },
    } as unknown as QuotationDetailDto;
    const def = buildQuotationDocument(quote);
    expect(def.documentTitle).toBe('Quotation');
    expect(def.meta.find((m) => m.label === 'Revision')?.value).toBe('#2');
    expect(def.totals?.at(-1)?.value).toContain('900.00');
  });

  it('receipt: has no line table, lists what the payment was applied to', () => {
    const payment = {
      number: 'PMT-000045',
      customerName: 'Blue Sky Ltd',
      paymentDate: '2026-01-10',
      amount: '200.00',
      currency: 'GBP',
      method: 'BANK_TRANSFER',
      reference: null,
      notes: null,
      status: 'RECORDED',
      allocatedAmount: '200.00',
      unallocatedAmount: '0.00',
      allocations: [
        {
          id: 'a1',
          invoiceNumber: 'INV-000123',
          amount: '200.00',
          reversed: false,
        },
      ],
    } as unknown as PaymentDetailDto;
    const def = buildReceiptDocument(payment);
    expect(def.documentTitle).toBe('Payment Receipt');
    expect(def.table).toBeUndefined();
    expect(def.sections?.[0]?.lines[0]).toContain('INV-000123');
  });

  it('credit note: shows the reason and the credit amount', () => {
    const cn = {
      number: 'CN-000003',
      status: 'ISSUED',
      customerName: 'Blue Sky Ltd',
      invoiceNumber: 'INV-000123',
      currency: 'GBP',
      issueDate: '2026-01-12',
      reason: 'Goodwill adjustment',
      amount: '50.00',
      notes: null,
    } as unknown as CreditNoteDto;
    const def = buildCreditNoteDocument(cn);
    expect(def.documentTitle).toBe('Credit Note');
    expect(def.sections?.[0]?.lines[0]).toBe('Goodwill adjustment');
    expect(def.totals?.[0]?.value).toContain('50.00');
  });
});

describe('DocumentPdfService.render', () => {
  const service = new DocumentPdfService();

  it('returns real, non-trivial PDF bytes (a %PDF header and an %%EOF trailer)', async () => {
    const buf = await service.render(buildInvoiceDocument(invoice), branding);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buf.subarray(-6).toString('ascii').trim()).toBe('%%EOF');
  });

  it('embeds the tenant branding — the business name is the PDF author', async () => {
    const buf = await service.render(buildInvoiceDocument(invoice), branding);
    const doc = await PDFDocument.load(buf);
    expect(doc.getAuthor()).toBe('Aurora Renewables');
    expect(doc.getTitle()).toContain('INV-000123');
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders with the platform default colour when the tenant has none', async () => {
    const buf = await service.render(
      buildReceiptDocument({
        number: 'PMT-1',
        customerName: 'X',
        paymentDate: '2026-01-01',
        amount: '1.00',
        currency: 'GBP',
        method: 'CASH',
        reference: null,
        notes: null,
        status: 'RECORDED',
        allocatedAmount: '0.00',
        unallocatedAmount: '1.00',
        allocations: [],
      } as unknown as PaymentDetailDto),
      { ...branding, primaryColor: null, logo: null },
    );
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
