# Product UX

_Phase 13B · ADR 0042. See also `PLATFORM-ACCESS.md`, `AUTHORIZATION.md`,
`MODULE-ENTITLEMENTS.md`, `BRANDING.md`, `FRONTEND.md`._

Phase 13B makes Aivoryx feel like one **premium, fast, access-aware SaaS
product** rather than a set of CRUD screens. CRM is the **reference
implementation** — the visual and interaction standard later applied to HR,
Field, Supply, Commercial, EPC and Finance.

## Design principles

- **Fast and calm.** Server-side pagination and filters, debounced search,
  TanStack Query caching + targeted invalidation, skeletons for structure (never
  a full-page spinner), optimistic updates only where a rollback is safe.
- **Information-dense where it helps.** Compact tables, tabular numerals for
  counts, restrained type scale — a business app needs readable density, not
  oversized headings.
- **Predictable.** One component vocabulary, consistent status semantics, the
  same page anatomy (`PageHeader` → content → sticky actions) everywhere.
- **Accessible.** Semantic HTML, visible focus, focus-trapped dialogs, real
  button/menu semantics, `prefers-reduced-motion` respected, ≥44px touch
  targets, no hover-only interactions.
- **Aivoryx identity, tenant-first.** The tenant's name/logo/colour lead; the
  Aivoryx mark is subtle ("Powered by Aivoryx™"). A platform admin sees
  "Aivoryx Platform".
- **Restraint.** Subtle motion on overlays only; no decorative gradients, giant
  cards, or animation that slows interaction.

## The application shell

`apps/web/components/app-shell.tsx` — one shell, three form factors:

|             | Desktop (`md+`)                                      | Tablet            | Mobile                                 |
| ----------- | ---------------------------------------------------- | ----------------- | -------------------------------------- |
| Primary nav | branded left sidebar, groups expand                  | same, collapsible | bottom nav (5 pinned) + "More" sheet   |
| Top bar     | search/⌘K trigger · notification bell · account menu | same              | brand · search · bell · menu           |
| Content     | centred `max-w-6xl` column                           | fluid             | full-width, `pb-20` for the bottom bar |

`/field/*`, `/login` and `/accept-invitation` opt out of the shell entirely
(the Field PWA keeps its purpose-built bottom-nav chrome — Phase 13B does not
touch it).

## Module-aware navigation (centralized registry)

`apps/web/lib/navigation/registry.ts` — `TENANT_NAV` and `PLATFORM_NAV`. Each
entry: `{ key, label, href?, icon, module?, permission?, order, children? }`.

`useNavigation()` filters the registry by:

1. **platform role** — a platform admin with no active workspace gets
   `PLATFORM_NAV`; every `/platform/*` route forces it;
2. **tenant entitlements** — an entry with a `module` is dropped unless
   `entitledModules` contains it;
3. **effective permissions** — an entry with a `permission` is dropped unless
   the user holds it (effective = already entitlement-filtered).

A parent group renders only if a child survives. **Unauthorised links are not
rendered** — navigation, the command palette, dashboard widgets and search all
consult the same `useAccess()` view, so Company B (CRM + Supply) never shows HR,
Field, Finance or EPC anywhere. `useAccess()` derives everything from
`/auth/me` — the frontend invents no authorization (ADR 0042 §58).

## Platform admin experience

A visually distinct console (dark brand mark, "Platform administration" footer):

- `/platform` — overview: company counts, module catalogue with dependencies,
  recent companies. Loading / error / empty / populated states.
- `/platform/tenants` — a searchable, sortable, filterable company table
  (mobile: cards).
- `/platform/tenants/:tenantId` — company detail + **module entitlement
  management**: each module shows state, dependencies, enable/disable. Enabling
  is blocked (button disabled + hint) until dependencies are on; disabling is
  blocked while an enabled module depends on it (`Lock` hint) and always
  **confirmed** — Aivoryx never cascades. Dependency-rejection errors from the
  API are shown verbatim in a toast.
- `/platform/modules` — the read-only catalogue grouped by category.

## Tenant admin — access experience

`/admin/access` (three tabs, plain-language, no raw permission keys as the
primary surface):

- **Users** — pick a member → assign a **profile + data scope**, add/remove
  **permission sets**, and read **effective access** per module: entitlement,
  granted permissions (human labels), and the data scope where it applies.
  Helper text explains the model in one sentence.
- **Profiles** / **Permission sets** — create/edit with a **module-grouped
  permission picker** fed by `GET /admin/access/available-permissions`, which
  the server filters to entitled modules. A permission that belongs to a
  non-entitled module cannot be selected, and the API's
  `ACCESS_PERMISSION_NOT_AVAILABLE` is surfaced inline.

## Dashboard framework (Phase 13C)

`/` is a **composition of widgets**, not seven hand-built dashboards.

- `apps/web/lib/dashboard/registry.tsx` — the widget registry. Each entry:
  `{ key, module?, permissions?, title, span, priority, Component }`. Each
  business module contributes entries here; this is the single cross-module
  composition point.
- `apps/web/lib/dashboard/select.ts` — `selectDashboardWidgets(widgets, access)`
  is a **pure** function (unit-tested): a widget shows iff its `module` is
  entitled **and** every `permission` is held. Role-awareness is emergent — a
  Sales user only holds `crm.*`, so only CRM widgets pass; a Tenant Admin sees
  the full board. Widgets are sorted by `priority`.
- `apps/web/components/dashboard/*-widgets.tsx` — one file per module concern
  (`crm-`, `hr-`, `finance-`, `field-`, `common-`). Each widget owns its own
  data fetch via that module's existing hooks (`useCrmOverview`,
  `useHrDashboard`, `useFinanceOverview`, `useVisits`) — the dashboard framework
  and `/` page import **no** business service.
- Widgets have their own loading / error / empty states (`WidgetSkeleton`,
  `WidgetError`, `WidgetStat`). No widget fetches data for a module the user
  cannot access; §36 verified by `dashboard.spec.ts` (a CRM+Supply tenant never
  renders HR / Finance / Field widgets, even with the permissions).
- Responsive: a 12-column grid on `md+`, single column on mobile;
  `data-testid="widget-<key>"` on each cell.

A future module contributes a dashboard widget by pushing one registry entry —
the page does not change.

## CRM flagship (the standard)

- **`/crm` overview** — real KPIs from the existing `GET /crm/leads` endpoint
  (total, open, qualified, conversion), a leads-by-status bar chart that links
  into filtered lists, and recent leads. Quick "New lead" action.
- **`/crm/leads` — premium workspace (Phase 13C):**
  - toolbar: debounced search, status + assignee filters that render as
    **removable chips** with "Clear all", a **Saved views** menu, and a
    **Table / Board** toggle.
  - **Saved views** are server-persisted (`crm_saved_views`, owned per
    membership — never shared across users or tenants, RLS + query-scoped).
    The UI stores a small `{ q, status, assignedMembershipId, board }` config;
    `serializeViewConfig` / `parseViewConfig` are pure and unit-tested.
  - **Board view** — kanban columns by the existing lead lifecycle
    (`NEW → … → CONVERTED`); cards open the workspace. No second status model.
  - **Bulk actions** — select rows → assign / change status. Each row goes
    through the existing per-lead endpoint, so the CRM lifecycle rules still
    apply to every lead; a status transition that isn't allowed leaves that
    lead unchanged and the toast reports "N updated, M could not be changed".
    High-impact bulk status changes are confirmed.
  - **Mobile** — the table is `hidden md:block`; a **card list** renders below
    it on small screens. Quick create is a full dialog.
- **`/crm/leads/:id` — record workspace (Phase 13C):** a strong header (name,
  status, phone/email/owner/source, prominent **Call / Follow-up / Edit**
  actions) over a tab bar — **Overview** (contact + custom fields + "move the
  lead forward" + log-a-call), **Activity** (a real vertical timeline with
  per-type labels), **Follow-ups** (grouped overdue / upcoming / completed with
  quick actions), **Notes** (inline add/edit/delete), **Related** (site visits,
  quotations, project — each hidden when the member lacks that module's read
  permission). Editing is a grouped dialog (Contact / Location); industry
  specifics stay in custom fields.
- **Module sub-nav** — Overview · Leads · Customers · Visits, itself
  entitlement/permission-filtered.
- **Command palette (⌘/Ctrl-K)** — navigate, create (only commands the user is
  authorised for — "Create Lead" needs CRM + `crm.leads.read`/`crm.leads.create`),
  and debounced search over leads + customers, grouped by type, full keyboard
  nav.
- **Quick create** — a fast dialog from the dashboard, the list, and the
  command palette; `/crm/leads?new=1` opens it, `?status=` deep-links a filtered
  list.

## Feedback, states, motion

- **Toasts** (`components/ui/toast.tsx`) for transient confirmations; important
  errors stay in context (`ErrorBlock`, with a Ref id, a Try-again affordance,
  and distinct copy for entitlement vs permission failures — never a stack
  trace).
- **Empty states** are actionable ("No leads yet … Create Lead").
- **Confirmations** (`Confirm`) for module disable, access removal, deletes.
- Overlays (`Dialog`, `Sheet`, `Menu`, command palette) are focus-trapped,
  Esc-dismissible, and the only place motion is used.

## Component system

`apps/web/components/ui/*` (overlays, toast, command palette, kit) +
`components/admin/ui.tsx` (page primitives) + `packages/ui` (`Button`, tokens,
Tailwind preset). No second styling system; tokens are the HSL CSS variables in
`packages/ui/src/styles.css`, with the tenant brand colour a safe two-token
(`--primary`, `--ring`) override (Phase 10 `BrandProvider`, contrast-clamped).

**Recommended next step:** adopt Radix primitives under `components/ui/*` for
the menu/dialog/tooltip internals (kept dependency-free in 13B) and promote the
shared kit into `packages/ui` as the vocabulary stabilises.

## Route protection

Frontend guards are UX, not security. `/platform/*` redirects a
non–platform-admin home; module layouts still render the API's stable
`ENTITLEMENT_MODULE_NOT_ENABLED` message instead of data when a tenant lacks the
module. The backend guard + RLS remain authoritative.

## Future UX rollout

Apply the CRM standard, in order, to: HR self-service → Field → Finance →
Commercial → Supply → EPC. Each module gets: a dashboard widget (one registry
entry), an overview with real KPIs, an entitlement/permission-filtered sub-nav,
a list with removable-chip filters + saved views + mobile cards, a tabbed
record workspace, and command-palette create actions. Phase 13C established
every one of those patterns on the dashboard and CRM; later modules copy them.

Deferred within CRM (see ROADMAP): drag-and-drop board transitions, date /
source / follow-up-state list filters (need extra `GET /crm/leads` params),
column show/hide, and promoting `components/ui/*` into `packages/ui`.
