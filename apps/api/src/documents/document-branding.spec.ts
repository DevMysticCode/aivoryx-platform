import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { contrastRatio } from '@aivoryx/shared';
import { documentLogoKinds, resolveDocumentAccent } from '../settings/company-profile.service.js';
import { UpdateCompanyProfileDto } from '../settings/settings.dto.js';
import {
  buildCreditNoteDocument,
  buildInvoiceDocument,
  buildQuotationDocument,
} from './builders.js';
import type { DocumentBranding } from '../settings/company-profile.service.js';

const mocks = vi.hoisted(() => ({
  readCustomerLogo: vi.fn(),
  getDocumentBranding: vi.fn(),
  pdfRender: vi.fn(),
}));

vi.mock('@aivoryx/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aivoryx/db')>()),
  getDb: () => ({}),
  withTenantContext: (_db: unknown, _scope: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('../commercial/customer-logo.service.js', () => ({
  readCustomerLogo: mocks.readCustomerLogo,
}));

import { DocumentRenderService } from './document-render.service.js';
import type { DocumentDefinition } from './document.types.js';

const baseBranding = (over: Partial<DocumentBranding> = {}): DocumentBranding => ({
  businessName: 'Acme',
  legalName: null,
  addressLines: [],
  taxLine: null,
  contactLines: [],
  primaryColor: '#00a19a',
  accentColor: '#00807b',
  showCustomerLogo: false,
  documentFooter: null,
  logo: null,
  ...over,
});

const scope = { tenantId: 't1', userId: 'u1', actorMembershipId: 'm1' } as never;
const def = (customerId?: string): DocumentDefinition => ({
  documentTitle: 'Invoice',
  documentNumber: 'INV-1',
  meta: [],
  party: { heading: 'Bill to', lines: ['Blue Sky'], ...(customerId ? { customerId } : {}) },
});

describe('DocumentRenderService customer-logo gating', () => {
  const logo = { body: Buffer.from('x'), contentType: 'image/png' };
  let svc: DocumentRenderService;

  beforeEach(() => {
    mocks.readCustomerLogo.mockReset().mockResolvedValue(logo);
    mocks.getDocumentBranding.mockReset();
    mocks.pdfRender.mockReset().mockResolvedValue(Buffer.from('%PDF'));
    svc = new DocumentRenderService(
      { render: mocks.pdfRender } as never,
      { getDocumentBranding: mocks.getDocumentBranding } as never,
      { getObject: vi.fn() } as never,
    );
  });

  it('never reads or renders the customer logo when the tenant flag is off', async () => {
    mocks.getDocumentBranding.mockResolvedValue(baseBranding({ showCustomerLogo: false }));
    await svc.render(scope, def('c1'));
    expect(mocks.readCustomerLogo).not.toHaveBeenCalled();
    expect(mocks.pdfRender.mock.calls[0]![1].customerLogo).toBeNull();
  });

  it('reads the customer logo when the flag is on and the party has a customer id', async () => {
    mocks.getDocumentBranding.mockResolvedValue(baseBranding({ showCustomerLogo: true }));
    await svc.render(scope, def('c1'));
    expect(mocks.readCustomerLogo).toHaveBeenCalledTimes(1);
    expect(mocks.readCustomerLogo.mock.calls[0]![2]).toBe('c1');
    expect(mocks.pdfRender.mock.calls[0]![1].customerLogo).toEqual(logo);
  });

  it('does not read a logo when the party has no customer id, even with the flag on', async () => {
    mocks.getDocumentBranding.mockResolvedValue(baseBranding({ showCustomerLogo: true }));
    await svc.render(scope, def());
    expect(mocks.readCustomerLogo).not.toHaveBeenCalled();
  });

  it('a failing customer-logo read does not fail the render', async () => {
    mocks.getDocumentBranding.mockResolvedValue(baseBranding({ showCustomerLogo: true }));
    mocks.readCustomerLogo.mockRejectedValue(new Error('storage down'));
    await expect(svc.render(scope, def('c1'))).resolves.toMatchObject({ filename: 'INV-1.pdf' });
    expect(mocks.pdfRender.mock.calls[0]![1].customerLogo).toBeNull();
  });
});

describe('document branding selection', () => {
  it('company mode only ever asks for the company logo', () => {
    expect(documentLogoKinds('company')).toEqual(['logo']);
    expect(documentLogoKinds(null)).toEqual(['logo']);
  });

  it('separate mode prefers the document logo, then falls back to the company logo', () => {
    expect(documentLogoKinds('separate')).toEqual(['logo_document', 'logo']);
  });

  it('derives a print-safe accent (>= 4.5:1 on white) from a pale primary', () => {
    const accent = resolveDocumentAccent(null, '#ffe600');
    expect(contrastRatio(accent, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('prefers the dedicated document accent over the primary', () => {
    expect(resolveDocumentAccent('#1e3a8a', '#ffe600')).toBe('#1e3a8a');
  });

  it('falls back to a safe default when nothing is configured', () => {
    expect(contrastRatio(resolveDocumentAccent(null, null), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('builders set party.customerId', () => {
  it('quotation, invoice and credit note carry the customer id', () => {
    const q = buildQuotationDocument({
      number: 'Q1',
      status: 'DRAFT',
      customerId: 'cq',
      customerName: 'A',
      leadName: null,
      currentRevision: { revisionNo: 1, lines: [], createdAt: '2026-01-01T00:00:00Z' },
    } as never);
    expect(q.party?.customerId).toBe('cq');
    const i = buildInvoiceDocument({
      number: 'I1',
      customerId: 'ci',
      customerName: 'B',
      lines: [],
      allocations: [],
      currency: 'GBP',
    } as never);
    expect(i.party?.customerId).toBe('ci');
    const c = buildCreditNoteDocument({
      number: 'C1',
      customerId: 'cc',
      customerName: 'C',
      currency: 'GBP',
      reason: 'x',
    } as never);
    expect(c.party?.customerId).toBe('cc');
  });

  it('omits customerId when the quotation has no customer yet', () => {
    const q = buildQuotationDocument({
      number: 'Q1',
      status: 'DRAFT',
      customerId: null,
      customerName: null,
      leadName: 'Lead',
      currentRevision: { revisionNo: 1, lines: [], createdAt: '2026-01-01T00:00:00Z' },
    } as never);
    expect(q.party?.customerId).toBeUndefined();
  });
});

describe('UpdateCompanyProfileDto branding validation', () => {
  const check = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateCompanyProfileDto, body))).map((e) => e.property);

  it('accepts valid theme / document fields', async () => {
    expect(
      await check({
        themePreset: 'ocean',
        secondaryColor: '#231d45',
        documentAccentColor: '#8a5a12',
        documentLogoMode: 'separate',
        documentShowCustomerLogo: true,
      }),
    ).toEqual([]);
  });

  it('rejects an unknown preset, bad hexes, bad mode and non-boolean flag', async () => {
    const props = await check({
      themePreset: 'neon',
      secondaryColor: 'red',
      documentAccentColor: '#12',
      documentLogoMode: 'both',
      documentShowCustomerLogo: 'yes',
    });
    expect(props.sort()).toEqual(
      [
        'documentAccentColor',
        'documentLogoMode',
        'documentShowCustomerLogo',
        'secondaryColor',
        'themePreset',
      ].sort(),
    );
  });
});
