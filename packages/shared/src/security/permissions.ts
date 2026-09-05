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
