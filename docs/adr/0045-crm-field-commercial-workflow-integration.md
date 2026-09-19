# ADR 0045 — CRM ↔ Field ↔ Commercial workflow integration

Status: accepted (Phase 18). Builds on 0031 (CRM), 0033 (Field), 0035 (Commercial), 0042 (entitlements + data scope), 0037 (notifications), 0040 (audit), 0044 (HR data scope).

## Context

CRM, Field and Commercial were already wired _through the lead_ (visits and quotations both reference `leads`), but the integration was accidental rather than designed: nothing let a user start a visit from a lead, a visit had no conclusion CRM could act on, `POST /visits` and `POST /quotations` checked only that the lead existed (any holder of the module's create permission could target any lead — no CRM permission, no data scope), cross-module links were unconditional (they hid only because a failed request returned `null`), and there was no reference from a quotation to the site assessment it came from.

## Decisions

1. **No new "Sales" module; ownership does not move.** CRM owns leads/follow-ups, Field owns visits and their outcome, Commercial owns quotations, Execution owns projects. Integration is by **explicit typed references** (`visits.lead_id` existing; new `quotations.visit_id`) and narrow, module-owned capabilities — no generic relation table.
2. **Both sides must allow it.** Where CRM is entitled, scheduling a visit or creating a quotation for a lead needs the module's create permission **and** `crm.leads.read` **and** the lead inside the caller's CRM data scope (`assertLeadAccessible`, `crm/lead-access.ts`). Where CRM is _not_ entitled, Field/Commercial stand alone (lead existence only). The server derives entitlement/permission from the security context; the client never supplies it.
3. **CRM data scope is now real in CRM.** `LeadsService.list/get` honour the caller's profile scope (only OWN narrows — CRM has no team/department structure, as in CRM analytics). Visits and quotations reached through CRM follow it. Writes always read back the record they changed (an OWN rep can create or hand off a lead).
4. **Never leak existence.** Out-of-scope leads/visits are indistinguishable from missing ones (`LEAD_NOT_FOUND` / `VISIT_NOT_FOUND`, 404). `GET /visits?leadId=` for a lead the caller cannot open is an empty page. A quotation reveals its `visitId`/`visit` only to callers who may see that visit; a quotation cannot be created against a visit the caller cannot see (plain 404).
5. **Visit outcome is Field's, three values only:** `SUITABLE | NOT_SUITABLE | FOLLOW_UP_REQUIRED` (`visits.outcome`, `outcome_note`; nullable — completing without one is unchanged). A visit that could not happen is CANCELLED, not an outcome. The outcome rides the `visit_completed` lead-timeline entry, the audit record and the `visit.completed` event.
6. **`FOLLOW_UP_REQUIRED` creates the CRM follow-up atomically** through the existing follow-up model (`createLeadFollowupTx`, exported by CRM, joined to Field's completion transaction, assigned to the lead owner, audited as `crm.lead.followup_created`) — only where CRM is entitled; otherwise the visit completes and no follow-up is created. No second task system.
7. **Quotation ← visit is a reference, not a copy.** `CreateQuotationDto.visitId` must be a COMPLETED visit of the same lead and visible to the caller; Commercial stores only the id and reads a minimal summary through Field's `findReferencableVisit`.
8. **Field agents gain no CRM access.** A visit carries only lead name/phone/site address (already in Field's own view); the CRM link is offered only with CRM access. Scheduling copies the lead's address as a snapshot; instructions become the visit's first note.
9. **Small, module-owned summaries for dashboards** (`GET /visits/summary`, `GET /quotations/pipeline-summary`) with real counts bound to the caller's visibility/scope, so the CRM dashboard needs no cross-module aggregation infrastructure.
10. **Known structural coupling, deliberately unchanged:** `visits.lead_id` is NOT NULL, so Field stands alone only as far as leads exist in the workspace (they are created outside CRM, e.g. by Field's own "new lead"). Making visits lead-optional is a larger Field redesign, deferred.

## Consequences

- Existing workspaces keep working: default scope is COMPANY; outcome and `visit_id` are nullable; permissions unchanged.
- Users who could schedule visits/quotations for leads they cannot open in CRM (where CRM is enabled) now cannot — by design.
- UI offers cross-module links/actions only when module + permission allow (`useCrossModuleAccess`); hidden links are convenience, the API is the boundary.

## Future roadmap (not built)

Lead-optional visits (Field stand-alone customers); `projects.quotation_id/customer_id` typed references; site-assessment templates feeding quotation lines; opportunity/forecasting; multi-visit scheduling/routing; notifications for quotation approval/project booking beyond existing events.
