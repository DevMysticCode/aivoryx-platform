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
} from './relations.js';
