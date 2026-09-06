# ADR 0039 — Platform Experience: Tenant Branding, Onboarding & the Document Engine

Status: Accepted (Phase 10 — tenant company profile & branding, logo storage,
onboarding checklist, contextual guidance, a reusable branded PDF document
engine, and branded notification emails)

Builds on ADR 0033 / 0015 (object storage), ADR 0027 (RLS runtime role &
per-transaction tenant context), ADR 0029 (RBAC & permission catalogue),
ADR 0014 (stable error codes), ADR 0035 (quotations), ADR 0038 (finance
invoices / payments / credit notes), ADR 0037 (notification engine). It adds
**no** second tenant entity, **no** second file store, **no** workflow engine,
**no** CMS and **no** headless-browser infrastructure.

## Context

The platform was functionally complete through finance but still looked and
onboarded like an internal tool: one hard-coded "Aivoryx" mark, no company
identity on documents, quotation / invoice / receipt "print" was
server-rendered HTML only, a new workspace landed on an empty screen with no
guidance, and notification emails were unbranded. Phase 10 makes the product
feel like a polished multi-tenant SaaS **without** redesigning it.

## Decision

### 1. Tenant company profile — extend, don't replace

A single new `tenant_company_profiles` row per tenant holds white-label
configuration: legal / display name, contact details, a generic postal
address, a **generic** `tax_registration_label` + `tax_registration_number`
(never `gst_number` — the model is not India-specific), `document_footer`,
`timezone`, `default_currency`, and `primary_color` / `accent_color`. The
existing `tenants` row (id, slug, name, status) is untouched and remains the
identity/tenancy anchor.

### 2. Branding is a white-label boundary, never a security boundary

Branding affects **only** presentation: the app shell (name + logo), generated
documents, and notification email wrappers. It never affects internal API
identity, tenant ids, database ownership, RLS, permission semantics or
infrastructure. Aivoryx branding is never fully removed — a subtle
"Powered by Aivoryx™" attribution stays in the app footer, on every document
footer and in every branded email.

### 3. Logos reuse the Phase 4 object storage

`tenant_assets (tenant_id, kind ∈ {logo, logo_light, logo_dark, favicon})`
stores an opaque object key, sniffed content type, byte size and dimensions —
**no binary in Postgres**. Bytes live in the existing `ObjectStorageService`
(`OBJECT_STORAGE` token); there is no second file system. Keys are
server-generated (`tenants/<tenantId>/branding/<kind>/<uuid>.<ext>`);
authorization is the DB row + RLS, not key secrecy. Downloads go through an
authenticated API route (`GET /settings/company/logo`), never a public or
signed URL.

### 4. Image validation — never trust the client

`apps/api/src/settings/image-meta.ts` sniffs the format from magic bytes and
accepts **only** PNG / JPEG / WebP. SVG is rejected (it can carry script);
GIF/BMP/etc. are rejected. The client `Content-Type` must match the sniffed
format. Dimensions are read from the header and bounded (16px–4000px); size is
capped at 2 MB. Failures return `LOGO_INVALID` (422) with a machine reason.

### 5. Brand colour — a validated token override, not CSS injection

Colours are stored as `#rrggbb`, validated server-side (`@Matches` + a DB
CHECK). The web app converts the hex to an HSL triple and overrides exactly two
design tokens — `--primary` and `--ring` — via a single scoped `<style>` with
no selectors and no other declarations (`BrandProvider`). Lightness is clamped
to a readable band so the fixed near-white `--primary-foreground` keeps
contrast on primary surfaces — a tenant cannot pick a colour that breaks
accessibility. There is no mechanism to inject arbitrary CSS or JS.

### 6. Onboarding — a small typed model, derived steps

`tenant_onboarding` stores only `dismissed_at` / `dismissed_by`. The checklist
steps (company profile, branding, first team member, first customer, first lead
source) are a fixed typed array in code; each step's `done` is **derived** from
real domain data on read. Steps are filtered to those the caller's RBAC
permissions allow, so every link points at a screen the user can actually open.
`show = has visible steps ∧ not complete ∧ not dismissed`. No workflow engine,
no arbitrary JSON state. A member with no admin permissions gets an empty step
list and sees nothing.

### 7. Contextual guidance — one component set, versioned in code

`GuidanceCard`, `HelpTip` and `LifecycleTrail` (one set, not five competing
ones). Help copy lives in `apps/web/lib/help-content.ts` — versioned with the
code, reviewed like code, no CMS. `LifecycleTrail` is a **read-only** indicator
driven entirely by the API's authoritative status value; the frontend never
advances or infers state.

### 8. Document engine — structured data in, branded PDF out

A reusable engine (`apps/api/src/documents/`), not a per-document
implementation:

- `DocumentDefinition` — a generic model (title, number, status, metadata
  grid, counterparty block, line table, totals, sections, notes). Business
  modules build one of these from their own DTO and **recompute nothing** —
  the immutable issued financial snapshot flows straight through.
- `DocumentPdfService.render(def, branding)` — the **only** place PDF
  technology lives. Layout, typography, the branded header/footer, page
  numbers and totals are the engine's job. Tenants control only logo / colour
  / company details / footer; there is no template designer.
- `DocumentRenderService.render(scope, def)` — resolves the tenant's document
  branding (company details + colour + logo bytes, tenant-scoped) and calls
  the PDF service. The single entry point business modules use.

### 9. PDF renderer choice — pdfmake (pure Node), not a headless browser

**pdfmake `0.2.12` with the built-in Helvetica standard-14 AFM fonts.** It is
pure JavaScript: no headless Chromium, no system libraries, no font files, no
separate microservice. It therefore runs unchanged on the Railway Node service
(`DEPLOYMENT.md`), in local dev and in CI. A browser-based renderer
(Puppeteer / Playwright / wkhtmltopdf) was rejected: the deployment target is a
constrained Node container, the spec explicitly warns against adding heavyweight
browser infra that the environment may not support, and none of these documents
need HTML/CSS fidelity. The trade-off is that pdfmake is Latin-1 only, so
currency is shown as a 3-letter code rather than a symbol. The dependency is
isolated entirely behind `DocumentPdfService` — swapping renderers touches one
file.

### 10. Document downloads — authenticated and tenant-safe

`GET /quotations/:id/pdf`, `GET /finance/invoices/:id/pdf`,
`GET /finance/payments/:id/receipt.pdf`, `GET /finance/credit-notes/:id/pdf`.
Each requires the existing `*.read` permission, derives tenant / actor /
ownership server-side (never from the URL or a query param), loads the
tenant-scoped detail, and streams `application/pdf` with
`Content-Disposition: attachment; filename="INV-000123.pdf"` — a real PDF, no
HTML pretending to be one, no filesystem paths. PDFs are generated per request
and streamed; nothing is persisted. Cross-tenant requests get 404;
unauthenticated requests get 401.

### 11. Branded notification emails — safe wrapper only

`event-context.ts` gains a `tenant` context with `displayName` / `brandColor` /
`documentFooter` (loaded from `tenant_company_profiles`). At delivery time the
email channel wraps the **already-escaped** plain-text body
(`brandedEmailHtml`) in a minimal shell: a brand-colour accent bar, the
workspace name, the body, and a "Powered by Aivoryx™" footer. Every
tenant-supplied value is HTML-escaped and the colour is format-validated —
there is **no** arbitrary tenant HTML. `NotificationModule` is not rewritten.

### 12. Permissions

Two new keys only: `settings.company.read`, `settings.company.update`.
Consuming branding (the app shell, `/auth/me`, the authenticated logo stream,
document branding, email branding) requires **no** permission — every member
sees their workspace's identity. `FIELD_AGENT` gets neither settings
permission; `TENANT_ADMIN` gets both via the full catalogue.

## Consequences

- New tables (migration `0012`, all `tenant_id` + ENABLE/FORCE RLS + composite
  `(id, tenant_id)` FKs + hex/currency CHECKs): `tenant_company_profiles`,
  `tenant_assets`, `tenant_onboarding`. 2 permissions, 5 error codes
  (`COMPANY_PROFILE_INVALID`, `BRAND_COLOR_INVALID`, `LOGO_INVALID`,
  `LOGO_NOT_FOUND`, `DOCUMENT_RENDER_FAILED`).
- New dependency: `pdfmake` (runtime). `pdf-lib` (dev, PDF test assertions).
  **No new environment variables** and no new runtime services — the API
  container needs nothing it did not already have.
- Adding a new document type = a new `DocumentDefinition` builder; the renderer
  and every security / branding path are unchanged.

## Out of scope (later phases)

Full help CMS, AI assistant / AI onboarding, a workflow builder, a
drag-and-drop document designer, custom tenant CSS/JS, arbitrary HTML email
templates, a customer portal, native-mobile branding, a marketing-website
builder, a theme marketplace, per-tenant frontend deploys, custom domains /
white-label DNS, a PDF archival system, and an accounting-grade document engine.
