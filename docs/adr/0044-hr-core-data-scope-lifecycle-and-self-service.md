# ADR 0044 — HR Core: data scope, onboarding lifecycle, self-service boundaries

Status: accepted (Phase 17). Builds on 0041 (HR module), 0042 (entitlements, `membership_roles.data_scope`), 0040 (audit), 0015 (object storage).

## Context

Phase 12 shipped a complete HR data model. Phase 17 audited it and found the gaps between "modelled" and "a reusable, safe HR capability":
`data_scope` was stored and editable but enforced nowhere in HR; `/hr/me/*` was `@AuthOnly()` so a workspace without HR (or with HR later disabled) still served payslips/leave; employees were created straight to ACTIVE; archived org units could still be assigned; the HR file could not be shared with the employee selectively.

## Decisions

1. **Enforce the existing data scope in HR — no second authorization model.** `apps/api/src/hr/data-scope.ts` reads the caller's _profile_ scope (`OWN | TEAM | DEPARTMENT | COMPANY`; no profile ⇒ COMPANY, as CRM analytics does). TEAM = self + direct reports (`hr_employees.manager_id`); DEPARTMENT = self + same department. A narrowed scope with no linked employee sees **nothing**. Applied to the employee record (list/detail/history/documents/compensation/bank), team views (attendance, leave list/calendar/balances, expense list, performance, dashboard) and the corresponding writes. Out-of-scope reads are **404, never 403** (no existence leak). Approvers keep access to requests _assigned to them_ wherever the requester sits. Permissions still decide _what_; scope decides _whose_.
2. **`ONBOARDING` lifecycle state** (`hr_employee_status`, migration 0020). ONBOARDING → ACTIVE | RESIGNED | TERMINATED only. Excluded from payroll (`ACTIVE/ON_LEAVE`), headcount and "active" metrics by construction. Creation accepts `ONBOARDING | ACTIVE` (default ACTIVE). Not an ATS/candidate pipeline.
3. **`@RequireModule('HR')` on `/hr/me/*`.** Entitlement is enforced for self-service; identity is still resolved from the membership, never the client.
4. **Document sharing is explicit** (`hr_employee_documents.shared_with_employee`, default false, migration 0021). Self-service lists/downloads only shared documents; downloads stay proxied through the API. Sharing changes are audited.
5. **Archive, not delete, for org units.** `ARCHIVED` units cannot be _newly_ assigned (`HR_ORG_UNIT_ARCHIVED`); current holders keep them. Unit/schedule updates are audited; schedules gained an update endpoint.
6. **Field ↔ HR:** one narrow, read-only, HR-owned capability (`WorkforceDirectoryService.linkedByMembership`) lets the field-agents list show the linked employee — only when HR is entitled, the caller holds `hr.employee.read`, and the employee is in their scope. No schema change, no duplicated employee data, Field works unchanged without HR.
7. **Notifications:** approver "needs your approval" (leave/expense submitted) and employee "not approved" (leave/expense rejected) use events HR already emitted — only catalogue templates/rules and context builders were added.

## Consequences

- Existing profiles default to COMPANY, so behaviour changes only when an admin narrows a scope.
- Data scope is per _profile_ (one per member). A second profile assignment is ambiguous by design.
- A ONBOARDING employee can still be linked to a login and use self-service; attendance/leave are not blocked by status (as for other non-active states today).

## Future roadmap (deliberately not built)

Finance adapter for approved expense claims (no matching Finance capability yet); recruiting/ATS before ONBOARDING; onboarding checklists/tasks; shift scheduling; biometric attendance; deeper-than-one-level reporting-chain scope; org-chart visualisation; statutory payroll.
