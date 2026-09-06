import { Injectable, Logger } from '@nestjs/common';
import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces.js';
import { AppError } from '@aivoryx/shared';
import type { DocumentBrandingContext, DocumentDefinition } from './document.types.js';

/**
 * The only place PDF rendering technology lives (Phase 10, ADR 0039).
 *
 * Uses **pdfmake** — pure JavaScript, no headless browser, no system libraries
 * — so it runs unchanged on the Railway Node service, in local dev and in CI.
 * The layout is a fixed, standardised professional business document: a branded
 * header (logo + company identity), a title, a metadata grid, the counterparty
 * block, a striped line table, a totals box, optional sections, notes, and a
 * page footer with the tenant footer line, a subtle "Powered by Aivoryx™"
 * attribution and page numbers. Tenants control only logo / colour / company
 * details / footer — there is no template designer.
 *
 * Business modules depend on this service's `render()` — never on pdfmake.
 */
@Injectable()
export class DocumentPdfService {
  private readonly logger = new Logger('DocumentPdf');
  // Standard-14 AFM fonts — embedded in every PDF reader, so no font files.
  private readonly printer = new PdfPrinter({
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  });

  async render(def: DocumentDefinition, branding: DocumentBrandingContext): Promise<Buffer> {
    try {
      const docDefinition = this.build(def, branding);
      const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];
      return await new Promise<Buffer>((resolve, reject) => {
        pdfDoc.on('data', (c: Buffer) => chunks.push(c));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);
        pdfDoc.end();
      });
    } catch (err) {
      this.logger.error(`document render failed: ${String(err)}`);
      throw new AppError('DOCUMENT_RENDER_FAILED');
    }
  }

  private build(def: DocumentDefinition, b: DocumentBrandingContext): TDocumentDefinitions {
    const accent = normaliseHex(b.primaryColor) ?? '#1e3a8a';
    const ink = '#1a1a1a';
    const muted = '#6b7280';
    const rule = '#e5e7eb';

    const logoImage = b.logo ? logoDataUri(b.logo) : null;

    const header: Content = {
      columns: [
        logoImage
          ? { image: logoImage, fit: [140, 48], width: 150 }
          : { text: b.businessName, style: 'brandName', width: 150 },
        {
          width: '*',
          alignment: 'right',
          stack: [
            { text: b.businessName, style: 'brandName' },
            ...b.addressLines.map((l) => ({ text: l, style: 'brandMeta' })),
            ...(b.taxLine ? [{ text: b.taxLine, style: 'brandMeta' }] : []),
            ...b.contactLines.map((l) => ({ text: l, style: 'brandMeta' })),
          ],
        },
      ],
      columnGap: 16,
      margin: [0, 0, 0, 6],
    };

    const titleRow: Content = {
      columns: [
        { text: def.documentTitle.toUpperCase(), style: 'docTitle', color: accent },
        def.status
          ? {
              text: def.status.replace(/_/g, ' '),
              style: 'statusChip',
              alignment: 'right',
              color: accent,
            }
          : { text: '', width: '*' },
      ],
      margin: [0, 14, 0, 8],
    };

    const metaGrid: Content = {
      columns: chunk(def.meta, 2).map((pair) => ({
        width: '*',
        stack: pair.map((m) => ({
          text: [
            { text: `${m.label}  `, style: 'metaLabel' },
            { text: m.value, style: 'metaValue' },
          ],
          margin: [0, 1, 0, 1],
        })),
      })),
      columnGap: 24,
      margin: [0, 0, 0, 10],
    };

    const partyBlock: Content = def.party
      ? {
          stack: [
            { text: def.party.heading.toUpperCase(), style: 'sectionLabel' },
            ...def.party.lines.map((l, i) => ({
              text: l,
              style: i === 0 ? 'partyName' : 'partyLine',
            })),
          ],
          margin: [0, 4, 0, 12],
        }
      : { text: '', margin: [0, 0, 0, 0] };

    const lineTable: Content = def.table
      ? {
          table: {
            headerRows: 1,
            widths: def.table.columns.map((c) =>
              c.width ? c.width * 40 : c.key === def.table!.columns[0]!.key ? '*' : 'auto',
            ),
            body: [
              def.table.columns.map((c) => ({
                text: c.label.toUpperCase(),
                style: 'th',
                alignment: c.align ?? 'left',
              })),
              ...def.table.rows.map((row, ri) =>
                def.table!.columns.map((c) => ({
                  text: row[c.key] ?? '',
                  style: 'td',
                  alignment: c.align ?? 'left',
                  fillColor: ri % 2 === 1 ? '#f9fafb' : undefined,
                })),
              ),
            ],
          },
          layout: {
            hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
              i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0,
            vLineWidth: () => 0,
            hLineColor: () => rule,
            paddingTop: () => 5,
            paddingBottom: () => 5,
            paddingLeft: () => 6,
            paddingRight: () => 6,
          },
          margin: [0, 4, 0, 10],
        }
      : { text: '', margin: [0, 0, 0, 0] };

    const totalsBlock: Content = def.totals?.length
      ? {
          columns: [
            { text: '', width: '*' },
            {
              width: 240,
              table: {
                widths: ['*', 'auto'],
                body: def.totals.map((t) => [
                  {
                    text: t.label,
                    style: t.emphasis ? 'totalLabelStrong' : 'totalLabel',
                    border: [false, false, false, false],
                    margin: t.emphasis ? [0, 6, 0, 0] : [0, 1, 0, 1],
                  },
                  {
                    text: t.value,
                    style: t.emphasis ? 'totalValueStrong' : 'totalValue',
                    alignment: 'right',
                    border: [false, t.emphasis ?? false, false, false],
                    borderColor: [rule, ink, rule, rule],
                    margin: t.emphasis ? [0, 6, 0, 0] : [0, 1, 0, 1],
                  },
                ]),
              },
              layout: 'noBorders',
            },
          ],
          margin: [0, 2, 0, 12],
        }
      : { text: '', margin: [0, 0, 0, 0] };

    const sectionBlocks: Content[] = (def.sections ?? []).map((s) => ({
      stack: [
        { text: s.heading.toUpperCase(), style: 'sectionLabel' },
        ...s.lines.map((l) => ({ text: l, style: 'partyLine' })),
      ],
      margin: [0, 4, 0, 10],
    }));

    const notesBlock: Content = def.notes?.trim()
      ? {
          stack: [
            { text: 'NOTES', style: 'sectionLabel' },
            { text: def.notes.trim(), style: 'partyLine' },
          ],
          margin: [0, 4, 0, 4],
        }
      : { text: '', margin: [0, 0, 0, 0] };

    return {
      pageSize: 'A4',
      pageMargins: [48, 44, 48, 60],
      defaultStyle: { font: 'Helvetica', fontSize: 9, color: ink, lineHeight: 1.25 },
      info: { title: `${def.documentTitle} ${def.documentNumber}`, author: b.businessName },
      footer: (currentPage: number, pageCount: number): Content => ({
        margin: [48, 12, 48, 0],
        columns: [
          {
            width: '*',
            text: b.documentFooter?.trim() || 'Powered by Aivoryx™',
            style: 'footerText',
          },
          {
            width: 'auto',
            text: `Page ${currentPage} of ${pageCount}${b.documentFooter?.trim() ? '  ·  Powered by Aivoryx™' : ''}`,
            style: 'footerText',
            alignment: 'right',
          },
        ],
      }),
      content: [
        {
          canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 3, color: accent }],
          margin: [0, 0, 0, 10],
        },
        header,
        titleRow,
        metaGrid,
        partyBlock,
        lineTable,
        totalsBlock,
        ...sectionBlocks,
        notesBlock,
      ],
      styles: {
        brandName: { fontSize: 13, bold: true },
        brandMeta: { fontSize: 8, color: muted },
        docTitle: { fontSize: 18, bold: true },
        statusChip: { fontSize: 9, bold: true, characterSpacing: 0.5 },
        metaLabel: { fontSize: 8, color: muted },
        metaValue: { fontSize: 9, bold: true },
        sectionLabel: {
          fontSize: 8,
          bold: true,
          color: muted,
          characterSpacing: 0.5,
          margin: [0, 0, 0, 3],
        },
        partyName: { fontSize: 10, bold: true },
        partyLine: { fontSize: 9, color: ink },
        th: { fontSize: 7.5, bold: true, color: muted, characterSpacing: 0.4 },
        td: { fontSize: 9 },
        totalLabel: { fontSize: 9, color: muted },
        totalValue: { fontSize: 9 },
        totalLabelStrong: { fontSize: 11, bold: true },
        totalValueStrong: { fontSize: 11, bold: true },
        footerText: { fontSize: 7.5, color: muted },
      },
    };
  }
}

function normaliseHex(v: string | null): string | null {
  return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

function logoDataUri(logo: { body: Buffer; contentType: string }): string {
  const type = /jpe?g/.test(logo.contentType) ? 'image/jpeg' : logo.contentType || 'image/png';
  return `data:${type};base64,${logo.body.toString('base64')}`;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out.length > 0 ? out : [[]];
}
