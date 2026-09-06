# Document Generation Engine

Phase 10 — ADR 0039. A reusable abstraction that turns **structured business
data** into a branded, downloadable PDF. It is implemented **once**; each
document type is just a `DocumentDefinition` builder.

See `docs/diagrams/document-generation.mmd`.

## Flow

```
business detail DTO
  → build<Type>Document(dto)            (apps/api/src/documents/builders.ts)
      → DocumentDefinition              (generic model — no layout, no branding)
  → DocumentRenderService.render(scope, def)
      → CompanyProfileService.getDocumentBranding(tx, tenantId, storageRead)
      → DocumentPdfService.render(def, branding)   (the ONLY place PDF tech lives)
  → StreamableFile  ·  application/pdf  ·  attachment; filename="INV-000123.pdf"
```

Business modules depend on `DocumentRenderService` — never on pdfmake.

## Modules (`apps/api/src/documents/`)

| File                         | Responsibility                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.types.ts`          | `DocumentDefinition` (title, number, status, meta grid, party, line table, totals, sections, notes), `DocumentBrandingContext`, `documentFilename()`            |
| `builders.ts`                | `buildQuotationDocument` / `buildInvoiceDocument` / `buildReceiptDocument` / `buildCreditNoteDocument` — pure DTO → `DocumentDefinition`; **recompute nothing** |
| `document-pdf.service.ts`    | the sole PDF-technology boundary — pdfmake; standardised system layout                                                                                          |
| `document-render.service.ts` | resolves tenant branding (tenant-scoped) + calls the PDF service                                                                                                |

## Renderer decision — pdfmake, pure Node

`pdfmake@0.2.12` with the built-in Helvetica standard-14 AFM fonts. Pure
JavaScript: **no headless Chromium, no system libraries, no font files, no
separate microservice.** It runs unchanged on the Railway Node API service
(`DEPLOYMENT.md`), locally and in CI.

A browser renderer (Puppeteer / Playwright / wkhtmltopdf) was rejected: the
deploy target is a constrained Node container, ADR 0039 explicitly warns against
adding heavyweight browser infra the environment may not support, and none of
these documents need HTML/CSS fidelity. Trade-off: pdfmake is Latin-1 only, so
currency renders as a 3-letter code, not a symbol. Swapping renderers touches
`document-pdf.service.ts` only.

**No new environment variables. No new runtime service.**

## Layout — standardised, tenant-controlled inputs only

A single professional business-document layout: a branded header (logo +
company identity), title + status chip, a metadata grid, the counterparty
block, a striped line table, a right-aligned totals box, optional sections,
notes, and a page footer with the tenant footer line, a subtle
"Powered by Aivoryx™" attribution and page numbers. There is **no** template
designer — tenants control only logo / colour / company details / footer.

## Downloads — authenticated & tenant-safe

| Route                                          | Permission                  |
| ---------------------------------------------- | --------------------------- |
| `GET /api/v1/quotations/:id/pdf`               | `quotations.read`           |
| `GET /api/v1/finance/invoices/:id/pdf`         | `finance.invoices.read`     |
| `GET /api/v1/finance/payments/:id/receipt.pdf` | `finance.payments.read`     |
| `GET /api/v1/finance/credit-notes/:id/pdf`     | `finance.credit_notes.read` |

Each route derives tenant / actor / ownership **server-side** (never from the
URL or a query param), loads the tenant-scoped detail, and streams a real
`application/pdf` with a `Content-Disposition` filename — no HTML pretending to
be a PDF, no filesystem paths. PDFs are generated per request and streamed;
nothing is persisted. Cross-tenant → 404. Unauthenticated → 401. The existing
server-rendered `/print` HTML endpoints are unchanged.

## Financial integrity

Builders map the **immutable issued snapshot** already on the detail DTO
straight through — amounts, tax and totals are never recomputed for the PDF,
and finance logic is not touched.

## Email branding

`apps/api/src/notifications/template.ts` `brandedEmailHtml()` wraps the
**already-escaped** plain-text notification body in a minimal shell (brand
accent bar, workspace name, "Powered by Aivoryx™" footer). Every tenant value
is HTML-escaped and the colour is format-validated — no arbitrary tenant HTML.
`NotificationModule` is not rewritten.
