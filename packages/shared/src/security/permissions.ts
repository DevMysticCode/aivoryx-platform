/**
 * The platform permission catalogue — the single source of truth (ADR 0011,
 * ADR 0029). `permissions` rows in the database are seeded from this list; API
 * guards reference these constants, never string literals.
 *
 * Keys are `<resource>.<action>` for platform/identity permissions, or the
 * namespaced `<domain>.<resource>.<action>` for a business module's own
 * permissions (e.g. `crm.leads.read`, ADR 0031). Stable once shipped. HR and
 * any other business domain add their own permissions here when they are
 * built — never a second catalogue or authorization model.
 */

export interface PermissionDefinition {
  key: string;
  description: string;
}

export const PERMISSION_DEFINITIONS = [
  { key: 'users.read', description: 'View users in the workspace.' },
  { key: 'users.create', description: 'Invite or create users in the workspace.' },
  { key: 'users.update', description: 'Edit user records in the workspace.' },
  { key: 'users.delete', description: 'Remove users from the workspace.' },

  { key: 'memberships.read', description: 'View workspace memberships and their roles.' },
  { key: 'memberships.update', description: 'Change a membership status or its role assignments.' },

  { key: 'roles.read', description: 'View roles defined in the workspace.' },
  { key: 'roles.create', description: 'Create a new role in the workspace.' },
  { key: 'roles.update', description: 'Edit a role or its permissions.' },
  { key: 'roles.delete', description: 'Delete a role from the workspace.' },

  { key: 'permissions.read', description: 'View the platform permission catalogue.' },

  { key: 'tenants.read', description: 'View the current workspace settings.' },
  { key: 'tenants.update', description: 'Edit the current workspace settings.' },

  // Platform access & module entitlements (Phase 13, ADR 0042). These are
  // platform-layer permissions owned by no business module (always available to
  // whoever holds them). `access.read` gates the tenant-side effective-access
  // summary; `platform.*` are held only by Aivoryx platform administrators
  // (the `platform_admins` table is the authoritative gate — see ADR 0042).
  { key: 'access.read', description: 'View a member’s effective access summary.' },
  { key: 'platform.tenants.read', description: 'Aivoryx platform: view workspaces.' },
  { key: 'platform.tenants.manage', description: 'Aivoryx platform: manage workspace lifecycle.' },
  {
    key: 'platform.modules.provision',
    description: 'Aivoryx platform: enable or disable a module for a workspace.',
  },

  // CRM core (Phase 3, ADR 0031/0032) — the reusable Lead domain.
  { key: 'crm.leads.read', description: 'View leads in the workspace.' },
  { key: 'crm.leads.create', description: 'Create leads manually.' },
  { key: 'crm.leads.update', description: 'Edit lead details, status, and custom fields.' },
  { key: 'crm.leads.assign', description: 'Assign or reassign a lead to a team member.' },
  { key: 'crm.leads.qualify', description: 'Qualify or disqualify a lead.' },
  { key: 'crm.leads.followup', description: 'Create, complete, and reschedule follow-ups.' },
  { key: 'crm.activities.read', description: 'View lead activity and notes.' },
  { key: 'crm.activities.create', description: 'Add notes and log call attempts on a lead.' },
  {
    key: 'crm.integrations.manage',
    description: 'Configure inbound lead connectors and manage inbound events.',
  },

  // Field operations (Phase 4, ADR 0033) — visits built on the CRM lead model.
  {
    key: 'field.agents.manage',
    description: 'Designate or deactivate field agents for the workspace.',
  },
  { key: 'field.visits.read', description: 'View site visits.' },
  { key: 'field.visits.create', description: 'Schedule a new site visit.' },
  { key: 'field.visits.update', description: 'Edit visit details.' },
  { key: 'field.visits.assign', description: 'Assign, reassign, reschedule, or cancel a visit.' },
  { key: 'field.visits.checkin', description: 'Check in or out of an assigned visit.' },
  { key: 'field.visits.survey', description: 'Complete the site survey for a visit.' },
  {
    key: 'field.visits.attachments',
    description: 'Upload or remove visit photos and attachments.',
  },
  { key: 'field.visits.complete', description: 'Mark an assigned visit complete.' },

  // Procurement, inventory & logistics (Phase 5, ADR 0034) — the operational
  // supply-chain layer. Generic, provider-neutral.
  { key: 'projects.read', description: 'View operational projects/orders.' },
  { key: 'projects.create', description: 'Create a project/order from a CRM lead.' },
  { key: 'projects.update', description: 'Edit a project and its material requirements.' },
  { key: 'projects.approve', description: 'Approve a project and move it into operations.' },

  { key: 'products.read', description: 'View the product/item catalogue.' },
  { key: 'products.create', description: 'Add products, categories, and units.' },
  { key: 'products.update', description: 'Edit products, categories, and units.' },

  { key: 'suppliers.read', description: 'View suppliers/vendors.' },
  { key: 'suppliers.create', description: 'Add a supplier/vendor.' },
  { key: 'suppliers.update', description: 'Edit a supplier/vendor.' },

  { key: 'warehouses.read', description: 'View warehouses and stock locations.' },
  { key: 'warehouses.create', description: 'Add a warehouse or stock location.' },
  { key: 'warehouses.update', description: 'Edit a warehouse or stock location.' },

  { key: 'inventory.read', description: 'View stock levels and movement history.' },
  { key: 'inventory.adjust', description: 'Post a manual stock adjustment.' },
  { key: 'inventory.allocate', description: 'Allocate or release project stock.' },
  { key: 'inventory.transfer', description: 'Transfer stock between warehouses.' },

  { key: 'procurement.read', description: 'View purchase orders and goods receipts.' },
  { key: 'procurement.create', description: 'Create purchase orders and lines.' },
  { key: 'procurement.update', description: 'Edit or cancel a draft purchase order.' },
  { key: 'procurement.approve', description: 'Approve a submitted purchase order.' },
  { key: 'procurement.receive', description: 'Record goods received against a purchase order.' },

  { key: 'dispatch.read', description: 'View dispatches and deliveries.' },
  { key: 'dispatch.create', description: 'Create a project dispatch.' },
  { key: 'dispatch.update', description: 'Edit or cancel a draft dispatch.' },
  { key: 'dispatch.dispatch', description: 'Send a dispatch out from the warehouse.' },
  { key: 'dispatch.deliver', description: 'Confirm delivery of a dispatch at the project site.' },

  // Commercial — customers, quotations & project booking (Phase 6, ADR 0035).
  { key: 'customers.read', description: 'View customers/commercial parties.' },
  { key: 'customers.create', description: 'Create a customer, or promote a lead to one.' },
  { key: 'customers.update', description: 'Edit a customer record.' },

  { key: 'quotations.read', description: 'View quotations and their revisions.' },
  { key: 'quotations.create', description: 'Create a quotation for a lead.' },
  { key: 'quotations.update', description: 'Edit the current draft revision of a quotation.' },
  { key: 'quotations.send', description: 'Mark a quotation as sent (freezes the revision).' },
  { key: 'quotations.accept', description: 'Record customer acceptance of a quotation.' },
  { key: 'quotations.cancel', description: 'Cancel a quotation.' },
  { key: 'quotations.revise', description: 'Create a new revision of an open quotation.' },
  {
    key: 'quotations.book',
    description: 'Book an accepted quotation — promotes the customer and activates the project.',
  },

  // EPC project execution (Phase 7, ADR 0036). Detailed execution state lives
  // in milestones/workflows, not in the project status enum.
  {
    key: 'projects.execution.read',
    description: 'View a project execution workspace (all projects).',
  },
  {
    key: 'projects.execution.update',
    description: 'Manage project execution: milestones, checklists, overrides.',
  },
  {
    key: 'projects.installation.assign',
    description: 'Assign or reassign an installation to a field agent.',
  },
  { key: 'projects.installation.read', description: 'View assigned installation work.' },
  {
    key: 'projects.installation.update',
    description: 'Record installation progress, notes and photos.',
  },
  { key: 'projects.installation.complete', description: 'Mark an installation complete.' },

  { key: 'projects.qc.read', description: 'View QC inspections and results.' },
  { key: 'projects.qc.create', description: 'Create a QC inspection for a project.' },
  { key: 'projects.qc.update', description: 'Record QC checklist and notes.' },
  { key: 'projects.qc.approve', description: 'Pass or fail a QC inspection.' },

  {
    key: 'projects.net_metering.read',
    description: 'View the net-metering / grid-connection record.',
  },
  {
    key: 'projects.net_metering.update',
    description: 'Update the net-metering / grid-connection record.',
  },

  { key: 'projects.handover.read', description: 'View the customer handover record.' },
  {
    key: 'projects.handover.update',
    description: 'Update the customer handover record and checklist.',
  },
  { key: 'projects.handover.complete', description: 'Complete the customer handover.' },

  {
    key: 'projects.complete',
    description: 'Complete a project once all execution requirements are met.',
  },
  { key: 'projects.defects.read', description: 'View project defects.' },
  { key: 'projects.defects.create', description: 'Raise a project defect.' },
  { key: 'projects.defects.update', description: 'Update or resolve a project defect.' },

  // Notifications & Communications Engine (Phase 8, ADR 0037). The per-user
  // notification list + own preferences need no permission (every authenticated
  // membership may see and manage its own); these gate tenant-wide configuration.
  { key: 'notifications.read', description: 'View your own notifications.' },
  {
    key: 'notifications.manage',
    description: 'Enable, disable or configure the tenant’s notification rules.',
  },
  { key: 'notifications.templates.read', description: 'View notification templates.' },
  {
    key: 'notifications.templates.manage',
    description: 'Edit or reset the tenant’s notification templates.',
  },
  {
    key: 'notifications.deliveries.read',
    description: 'View notification delivery history and failures.',
  },
  { key: 'notifications.preferences.read', description: 'View your notification preferences.' },
  {
    key: 'notifications.preferences.update',
    description: 'Change your notification preferences.',
  },

  // Finance — operational invoicing & payments (Phase 9, ADR 0038).
  { key: 'finance.read', description: 'View the finance overview and financial summaries.' },
  { key: 'finance.invoices.read', description: 'View invoices and their lines.' },
  { key: 'finance.invoices.create', description: 'Create draft invoices.' },
  { key: 'finance.invoices.update', description: 'Edit a draft invoice.' },
  {
    key: 'finance.invoices.issue',
    description: 'Issue an invoice (freezes its financial snapshot).',
  },
  { key: 'finance.invoices.cancel', description: 'Cancel or void an invoice.' },
  { key: 'finance.payments.read', description: 'View payments and their allocations.' },
  { key: 'finance.payments.create', description: 'Record a customer payment.' },
  { key: 'finance.payments.allocate', description: 'Allocate a payment to one or more invoices.' },
  { key: 'finance.payments.reverse', description: 'Reverse a recorded payment.' },
  { key: 'finance.credit_notes.read', description: 'View credit notes.' },
  { key: 'finance.credit_notes.create', description: 'Create a draft credit note.' },
  { key: 'finance.credit_notes.issue', description: 'Issue a credit note.' },
  { key: 'finance.credit_notes.cancel', description: 'Cancel a credit note.' },

  // Platform experience — tenant company profile & branding (Phase 10, ADR 0039).
  // Consuming branding (app shell, documents, emails) needs no permission; these
  // gate who may edit the workspace's company profile / branding / onboarding.
  { key: 'settings.company.read', description: 'View the workspace company profile and branding.' },
  {
    key: 'settings.company.update',
    description: 'Edit the workspace company profile, branding and logos.',
  },

  // Global Audit Log (Phase 11, ADR 0040). Read-only: the audit trail is
  // append-only and has no write/delete API. Not granted to a user just because
  // they can use a business module.
  { key: 'audit.read', description: 'View the workspace audit log.' },

  // HR & Workforce (Phase 12, ADR 0041). A bounded domain. Sensitive
  // permissions (compensation, bank details) are deliberately narrow and are
  // NOT implied by the general HR-read permissions.
  { key: 'hr.employee.read', description: 'View employee profiles (no salary or bank details).' },
  { key: 'hr.employee.create', description: 'Create employee profiles.' },
  { key: 'hr.employee.update', description: 'Edit employee profiles and employment details.' },
  {
    key: 'hr.employee.manage',
    description: 'Employee lifecycle, membership linking and documents.',
  },
  {
    key: 'hr.organization.read',
    description: 'View departments, designations, locations and the org chart.',
  },
  {
    key: 'hr.organization.manage',
    description: 'Manage departments, designations, locations and schedules.',
  },
  { key: 'hr.attendance.read', description: 'View team / workspace attendance.' },
  { key: 'hr.attendance.self', description: 'Record and view one’s own attendance.' },
  { key: 'hr.attendance.manage', description: 'Record attendance on behalf of employees.' },
  { key: 'hr.attendance.correct', description: 'Correct historical attendance records.' },
  { key: 'hr.leave.read', description: 'View team / workspace leave.' },
  { key: 'hr.leave.request', description: 'Request and cancel one’s own leave.' },
  { key: 'hr.leave.approve', description: 'Approve or reject leave requests assigned to me.' },
  { key: 'hr.leave.manage', description: 'Manage leave types, policies and balances.' },
  { key: 'hr.expense.read', description: 'View team / workspace expense claims.' },
  { key: 'hr.expense.submit', description: 'Create and submit one’s own expense claims.' },
  { key: 'hr.expense.approve', description: 'Approve or reject expense claims assigned to me.' },
  { key: 'hr.expense.manage', description: 'Manage expense categories and mileage rates.' },
  {
    key: 'hr.expense.reimburse',
    description: 'Record reimbursement payments for approved claims.',
  },
  { key: 'hr.compensation.read', description: 'View employee compensation (highly sensitive).' },
  {
    key: 'hr.compensation.manage',
    description: 'Create and change employee compensation records.',
  },
  {
    key: 'hr.bank_details.read',
    description: 'View employee bank / payment details (highly sensitive).',
  },
  { key: 'hr.bank_details.manage', description: 'Edit employee bank / payment details.' },
  { key: 'hr.payroll.read', description: 'View payroll periods, entries and payslips.' },
  { key: 'hr.payroll.manage', description: 'Create and edit draft payroll periods.' },
  { key: 'hr.payroll.process', description: 'Process (calculate) a payroll period.' },
  { key: 'hr.payroll.finalize', description: 'Finalize a payroll period (freezes its snapshot).' },
  { key: 'hr.payroll.payment', description: 'Record payroll payment processing.' },
  { key: 'hr.incentive.read', description: 'View incentive records.' },
  { key: 'hr.incentive.manage', description: 'Create and approve incentive records.' },
  { key: 'hr.performance.read', description: 'View performance periods, goals and reviews.' },
  { key: 'hr.performance.manage', description: 'Manage performance periods, goals and reviews.' },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSION_DEFINITIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_DEFINITIONS.map((p) => p.key);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);
const PERMISSION_DESCRIPTION: ReadonlyMap<string, string> = new Map(
  PERMISSION_DEFINITIONS.map((p) => [p.key, p.description]),
);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

export interface PermissionDescriptor {
  key: string;
  /** the resource segment, e.g. `leads` for `crm.leads.read`; `roles` for `roles.read` */
  resource: string;
  /** the action segment, e.g. `read` */
  action: string;
  description: string;
}

/**
 * Parse a permission key into its human-friendly parts for an access-summary
 * UI. `<domain>.<resource>.<action>` → resource/action from the last two
 * segments; `<resource>.<action>` → those two. The owning module is resolved
 * separately via `moduleForPermission` (module catalogue).
 */
export function describePermission(key: string): PermissionDescriptor {
  const parts = key.split('.');
  const action = parts[parts.length - 1] ?? key;
  const resource = parts.length >= 2 ? parts[parts.length - 2]! : key;
  return { key, resource, action, description: PERMISSION_DESCRIPTION.get(key) ?? key };
}

/**
 * Generic platform role keys. `TENANT_ADMIN` holds the full catalogue and is
 * seeded into every tenant (ADR 0029). No business roles (telecaller, field
 * agent, …) live in the platform core.
 */
export const PLATFORM_ROLE_KEYS = {
  tenantAdmin: 'TENANT_ADMIN',
  fieldAgent: 'FIELD_AGENT',
} as const;
export type PlatformRoleKey = (typeof PLATFORM_ROLE_KEYS)[keyof typeof PLATFORM_ROLE_KEYS];
