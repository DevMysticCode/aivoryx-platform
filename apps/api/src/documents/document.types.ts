/**
 * Generic document model (Phase 10, ADR 0039).
 *
 * A business module hands the document engine STRUCTURED DATA — never HTML,
 * never layout instructions. The engine (`DocumentPdfService`) owns layout,
 * typography, the branded header/footer, page numbers and totals. Adding a new
 * document type = building a `DocumentDefinition`; the renderer is unchanged.
 */

export interface DocMetaItem {
  label: string;
  value: string;
}

export interface DocParty {
  heading: string; // "Bill to", "Received from", …
  lines: string[];
  /** the CRM customer behind this party; used ONLY when the tenant enables customer logos */
  customerId?: string;
}

export interface DocColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** relative width weight; defaults to 1 */
  width?: number;
}

export interface DocTable {
  columns: DocColumn[];
  rows: Record<string, string>[];
}

export interface DocTotal {
  label: string;
  value: string;
  /** render bold with a rule above — the headline figure */
  emphasis?: boolean;
}

export interface DocSection {
  heading: string;
  lines: string[];
}

export interface DocumentDefinition {
  /** e.g. "TAX INVOICE", "QUOTATION", "PAYMENT RECEIPT", "CREDIT NOTE" */
  documentTitle: string;
  /** the human number, e.g. "INV-000123" — also the basis of the filename */
  documentNumber: string;
  /** short status chip shown by the title, e.g. "PAID" */
  status?: string;
  /** key/value metadata grid under the title (dates, currency, reference…) */
  meta: DocMetaItem[];
  /** the counterparty block (customer) */
  party?: DocParty;
  /** the main line-item table (optional — receipts have none) */
  table?: DocTable;
  /** right-aligned totals block */
  totals?: DocTotal[];
  /** extra sections after the totals (payment info, applied-to, …) */
  sections?: DocSection[];
  /** free-text notes */
  notes?: string | null;
}

export interface DocumentBrandingContext {
  businessName: string;
  addressLines: string[];
  taxLine: string | null;
  contactLines: string[];
  /** validated 6-digit hex, or null for the platform default */
  primaryColor: string | null;
  /** print-safe accent for rules/titles; falls back to primaryColor when absent */
  accentColor?: string;
  /** tenant flag: customer logos may be shown on documents */
  showCustomerLogo?: boolean;
  /** the customer's logo, loaded by the render service only when showCustomerLogo is true */
  customerLogo?: { body: Buffer; contentType: string } | null;
  /** tenant document footer line */
  documentFooter: string | null;
  /** logo bytes (png/jpeg/webp) or null */
  logo: { body: Buffer; contentType: string } | null;
}

/** Turn a document number into a safe PDF filename. */
export function documentFilename(documentNumber: string): string {
  const safe = documentNumber.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'document'}.pdf`;
}
