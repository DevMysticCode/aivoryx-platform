import { relations } from 'drizzle-orm';
import { outboxEvents, tenantInvitations } from './admin.js';
import { sessions, tenants, users, userTenantMemberships } from './identity.js';
import { membershipRoles, permissions, rolePermissions, roles } from './rbac.js';

/**
 * Drizzle relational-query wiring for the identity/tenancy/RBAC model.
 * Query sugar only — no effect on the generated SQL or migrations.
 */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(userTenantMemberships),
  sessions: many(sessions),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(userTenantMemberships),
  roles: many(roles),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  activeMembership: one(userTenantMemberships, {
    fields: [sessions.activeMembershipId],
    references: [userTenantMemberships.id],
    relationName: 'session_active_membership',
  }),
}));

export const userTenantMembershipsRelations = relations(userTenantMemberships, ({ one, many }) => ({
  user: one(users, { fields: [userTenantMemberships.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [userTenantMemberships.tenantId], references: [tenants.id] }),
  membershipRoles: many(membershipRoles),
  activeSessions: many(sessions, { relationName: 'session_active_membership' }),
  invitations: many(tenantInvitations),
}));

export const tenantInvitationsRelations = relations(tenantInvitations, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantInvitations.tenantId], references: [tenants.id] }),
  membership: one(userTenantMemberships, {
    fields: [tenantInvitations.membershipId],
    references: [userTenantMemberships.id],
  }),
  invitedBy: one(users, {
    fields: [tenantInvitations.invitedByUserId],
    references: [users.id],
  }),
}));

export const outboxEventsRelations = relations(outboxEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [outboxEvents.tenantId], references: [tenants.id] }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [roles.tenantId], references: [tenants.id] }),
  rolePermissions: many(rolePermissions),
  membershipRoles: many(membershipRoles),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const membershipRolesRelations = relations(membershipRoles, ({ one }) => ({
  membership: one(userTenantMemberships, {
    fields: [membershipRoles.membershipId],
    references: [userTenantMemberships.id],
  }),
  role: one(roles, { fields: [membershipRoles.roleId], references: [roles.id] }),
}));
