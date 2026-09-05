export { systemProbe, type SystemProbeRow } from './system.js';

// Phase 2, Task 1 — identity & tenancy data model (ADR 0026).
export {
  tenantStatus,
  userStatus,
  membershipStatus,
  tenants,
  users,
  userTenantMemberships,
  sessions,
  type TenantRow,
  type NewTenantRow,
  type UserRow,
  type NewUserRow,
  type UserTenantMembershipRow,
  type NewUserTenantMembershipRow,
  type SessionRow,
  type NewSessionRow,
} from './identity.js';

export {
  permissions,
  roles,
  rolePermissions,
  membershipRoles,
  type PermissionRow,
  type NewPermissionRow,
  type RoleRow,
  type NewRoleRow,
  type RolePermissionRow,
  type NewRolePermissionRow,
  type MembershipRoleRow,
  type NewMembershipRoleRow,
} from './rbac.js';

// Phase 2, Task 3 — tenant administration & user lifecycle (ADR 0030).
export {
  invitationStatus,
  tenantInvitations,
  outboxEvents,
  type TenantInvitationRow,
  type NewTenantInvitationRow,
  type OutboxEventRow,
  type NewOutboxEventRow,
} from './admin.js';

// Phase 3 — CRM core (ADR 0031).
export {
  leadStatus,
  leadActivityType,
  followupStatus,
  customFieldEntity,
  customFieldDataType,
  customFieldStatus,
  leads,
  leadActivities,
  leadNotes,
  leadFollowups,
  customFieldDefinitions,
  customFieldValues,
  type LeadRow,
  type NewLeadRow,
  type LeadActivityRow,
  type NewLeadActivityRow,
  type LeadNoteRow,
  type NewLeadNoteRow,
  type LeadFollowupRow,
  type NewLeadFollowupRow,
  type CustomFieldDefinitionRow,
  type NewCustomFieldDefinitionRow,
  type CustomFieldValueRow,
  type NewCustomFieldValueRow,
} from './crm.js';

// Phase 3 — inbound integration engine (ADR 0032).
export {
  connectorType,
  sourceStatus,
  rawEventStatus,
  canonicalEventStatus,
  leadSources,
  rawEvents,
  canonicalLeadEvents,
  integrationEventLog,
  type LeadSourceRow,
  type NewLeadSourceRow,
  type RawEventRow,
  type NewRawEventRow,
  type CanonicalLeadEventRow,
  type NewCanonicalLeadEventRow,
  type IntegrationEventLogRow,
  type NewIntegrationEventLogRow,
} from './integrations.js';

export {
  usersRelations,
  tenantsRelations,
  sessionsRelations,
  userTenantMembershipsRelations,
  rolesRelations,
  permissionsRelations,
  rolePermissionsRelations,
  membershipRolesRelations,
  tenantInvitationsRelations,
  outboxEventsRelations,
  leadsRelations,
  leadActivitiesRelations,
  leadNotesRelations,
  leadFollowupsRelations,
  customFieldDefinitionsRelations,
  customFieldValuesRelations,
  leadSourcesRelations,
  rawEventsRelations,
  canonicalLeadEventsRelations,
  integrationEventLogRelations,
} from './relations.js';
