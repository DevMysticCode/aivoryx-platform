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
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSION_DEFINITIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_DEFINITIONS.map((p) => p.key);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
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
