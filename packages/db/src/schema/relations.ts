import { relations } from 'drizzle-orm';
import { outboxEvents, tenantInvitations } from './admin.js';
import {
  notificationDeliveries,
  notificationPreferences,
  notificationRules,
  notificationTemplates,
  notifications,
} from './notifications.js';
import { creditNotes, invoiceLines, invoices, paymentAllocations, payments } from './finance.js';
import { tenantAssets, tenantCompanyProfiles, tenantOnboarding } from './branding.js';
import {
  customFieldDefinitions,
  customFieldValues,
  leadActivities,
  leadFollowups,
  leadNotes,
  leads,
} from './crm.js';
import {
  customers,
  quotationActivities,
  quotationAttachments,
  quotationLines,
  quotationRevisions,
  quotations,
} from './commercial.js';
import {
  projectChecklistItems,
  projectDefects,
  projectExecutionAttachments,
  projectHandover,
  projectInstallations,
  projectMilestones,
  projectNetMetering,
  projectQcInspections,
} from './execution.js';
import { fieldAgents, visitActivities, visitAttachments, visitNotes, visits } from './field.js';
import { sessions, tenants, users, userTenantMemberships } from './identity.js';
import {
  dispatchAttachments,
  dispatchLines,
  dispatches,
  goodsReceiptLines,
  goodsReceipts,
  productCategories,
  products,
  projectActivities,
  projectMaterials,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  stockLevels,
  stockMovements,
  suppliers,
  units,
  warehouses,
} from './supply.js';
import {
  canonicalLeadEvents,
  integrationEventLog,
  leadSources,
  rawEvents,
} from './integrations.js';
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

// --- CRM core (Phase 3, ADR 0031) ----------------------------------------

export const leadsRelations = relations(leads, ({ one, many }) => ({
  tenant: one(tenants, { fields: [leads.tenantId], references: [tenants.id] }),
  source: one(leadSources, { fields: [leads.sourceId], references: [leadSources.id] }),
  assignee: one(userTenantMemberships, {
    fields: [leads.assignedMembershipId],
    references: [userTenantMemberships.id],
  }),
  activities: many(leadActivities),
  notes: many(leadNotes),
  followups: many(leadFollowups),
}));

export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, { fields: [leadActivities.leadId], references: [leads.id] }),
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
}));

export const leadFollowupsRelations = relations(leadFollowups, ({ one }) => ({
  lead: one(leads, { fields: [leadFollowups.leadId], references: [leads.id] }),
}));

export const customFieldDefinitionsRelations = relations(customFieldDefinitions, ({ one }) => ({
  tenant: one(tenants, { fields: [customFieldDefinitions.tenantId], references: [tenants.id] }),
}));

export const customFieldValuesRelations = relations(customFieldValues, ({ one }) => ({
  definition: one(customFieldDefinitions, {
    fields: [customFieldValues.definitionId],
    references: [customFieldDefinitions.id],
  }),
}));

// --- Inbound integration engine (Phase 3, ADR 0032) ----------------------

export const leadSourcesRelations = relations(leadSources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [leadSources.tenantId], references: [tenants.id] }),
  leads: many(leads),
  rawEvents: many(rawEvents),
}));

export const rawEventsRelations = relations(rawEvents, ({ one }) => ({
  source: one(leadSources, { fields: [rawEvents.sourceId], references: [leadSources.id] }),
}));

export const canonicalLeadEventsRelations = relations(canonicalLeadEvents, ({ one }) => ({
  rawEvent: one(rawEvents, {
    fields: [canonicalLeadEvents.rawEventId],
    references: [rawEvents.id],
  }),
  source: one(leadSources, {
    fields: [canonicalLeadEvents.sourceId],
    references: [leadSources.id],
  }),
}));

export const integrationEventLogRelations = relations(integrationEventLog, ({ one }) => ({
  rawEvent: one(rawEvents, {
    fields: [integrationEventLog.rawEventId],
    references: [rawEvents.id],
  }),
  canonicalLeadEvent: one(canonicalLeadEvents, {
    fields: [integrationEventLog.canonicalLeadEventId],
    references: [canonicalLeadEvents.id],
  }),
}));

// --- Field operations (Phase 4, ADR 0033) ---------------------------------

export const fieldAgentsRelations = relations(fieldAgents, ({ one }) => ({
  tenant: one(tenants, { fields: [fieldAgents.tenantId], references: [tenants.id] }),
  membership: one(userTenantMemberships, {
    fields: [fieldAgents.membershipId],
    references: [userTenantMemberships.id],
  }),
}));

export const visitsRelations = relations(visits, ({ one, many }) => ({
  tenant: one(tenants, { fields: [visits.tenantId], references: [tenants.id] }),
  lead: one(leads, { fields: [visits.leadId], references: [leads.id] }),
  assignee: one(userTenantMemberships, {
    fields: [visits.assignedMembershipId],
    references: [userTenantMemberships.id],
  }),
  activities: many(visitActivities),
  notes: many(visitNotes),
  attachments: many(visitAttachments),
}));

export const visitActivitiesRelations = relations(visitActivities, ({ one }) => ({
  visit: one(visits, { fields: [visitActivities.visitId], references: [visits.id] }),
}));

export const visitNotesRelations = relations(visitNotes, ({ one }) => ({
  visit: one(visits, { fields: [visitNotes.visitId], references: [visits.id] }),
}));

export const visitAttachmentsRelations = relations(visitAttachments, ({ one }) => ({
  visit: one(visits, { fields: [visitAttachments.visitId], references: [visits.id] }),
}));

// --- Procurement, inventory & logistics (Phase 5, ADR 0034) --------------

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, { fields: [products.tenantId], references: [tenants.id] }),
  category: one(productCategories, {
    fields: [products.categoryId],
    references: [productCategories.id],
  }),
  unit: one(units, { fields: [products.unitId], references: [units.id] }),
  stockLevels: many(stockLevels),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [suppliers.tenantId], references: [tenants.id] }),
  purchaseOrders: many(purchaseOrders),
}));

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [warehouses.tenantId], references: [tenants.id] }),
  stockLevels: many(stockLevels),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tenant: one(tenants, { fields: [projects.tenantId], references: [tenants.id] }),
  lead: one(leads, { fields: [projects.leadId], references: [leads.id] }),
  materials: many(projectMaterials),
  activities: many(projectActivities),
  purchaseOrders: many(purchaseOrders),
  dispatches: many(dispatches),
}));

export const projectMaterialsRelations = relations(projectMaterials, ({ one }) => ({
  project: one(projects, { fields: [projectMaterials.projectId], references: [projects.id] }),
  product: one(products, { fields: [projectMaterials.productId], references: [products.id] }),
}));

export const projectActivitiesRelations = relations(projectActivities, ({ one }) => ({
  project: one(projects, { fields: [projectActivities.projectId], references: [projects.id] }),
}));

export const stockLevelsRelations = relations(stockLevels, ({ one }) => ({
  tenant: one(tenants, { fields: [stockLevels.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [stockLevels.warehouseId], references: [warehouses.id] }),
  product: one(products, { fields: [stockLevels.productId], references: [products.id] }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  tenant: one(tenants, { fields: [stockMovements.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [stockMovements.warehouseId], references: [warehouses.id] }),
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  project: one(projects, { fields: [stockMovements.projectId], references: [projects.id] }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [purchaseOrders.tenantId], references: [tenants.id] }),
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  project: one(projects, { fields: [purchaseOrders.projectId], references: [projects.id] }),
  lines: many(purchaseOrderLines),
  receipts: many(goodsReceipts),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderLines.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  product: one(products, { fields: [purchaseOrderLines.productId], references: [products.id] }),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [goodsReceipts.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  warehouse: one(warehouses, { fields: [goodsReceipts.warehouseId], references: [warehouses.id] }),
  lines: many(goodsReceiptLines),
}));

export const goodsReceiptLinesRelations = relations(goodsReceiptLines, ({ one }) => ({
  goodsReceipt: one(goodsReceipts, {
    fields: [goodsReceiptLines.goodsReceiptId],
    references: [goodsReceipts.id],
  }),
  purchaseOrderLine: one(purchaseOrderLines, {
    fields: [goodsReceiptLines.purchaseOrderLineId],
    references: [purchaseOrderLines.id],
  }),
}));

export const dispatchesRelations = relations(dispatches, ({ one, many }) => ({
  tenant: one(tenants, { fields: [dispatches.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [dispatches.projectId], references: [projects.id] }),
  warehouse: one(warehouses, { fields: [dispatches.warehouseId], references: [warehouses.id] }),
  lines: many(dispatchLines),
  attachments: many(dispatchAttachments),
}));

export const dispatchLinesRelations = relations(dispatchLines, ({ one }) => ({
  dispatch: one(dispatches, { fields: [dispatchLines.dispatchId], references: [dispatches.id] }),
  product: one(products, { fields: [dispatchLines.productId], references: [products.id] }),
  projectMaterial: one(projectMaterials, {
    fields: [dispatchLines.projectMaterialId],
    references: [projectMaterials.id],
  }),
}));

export const dispatchAttachmentsRelations = relations(dispatchAttachments, ({ one }) => ({
  dispatch: one(dispatches, {
    fields: [dispatchAttachments.dispatchId],
    references: [dispatches.id],
  }),
}));

// --- Phase 6 — commercial (ADR 0035) ------------------------------------

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  lead: one(leads, { fields: [customers.leadId], references: [leads.id] }),
  quotations: many(quotations),
  projects: many(projects),
}));

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [quotations.tenantId], references: [tenants.id] }),
  lead: one(leads, { fields: [quotations.leadId], references: [leads.id] }),
  customer: one(customers, { fields: [quotations.customerId], references: [customers.id] }),
  project: one(projects, { fields: [quotations.projectId], references: [projects.id] }),
  revisions: many(quotationRevisions),
  activities: many(quotationActivities),
  attachments: many(quotationAttachments),
}));

export const quotationRevisionsRelations = relations(quotationRevisions, ({ one, many }) => ({
  quotation: one(quotations, {
    fields: [quotationRevisions.quotationId],
    references: [quotations.id],
  }),
  lines: many(quotationLines),
}));

export const quotationLinesRelations = relations(quotationLines, ({ one }) => ({
  revision: one(quotationRevisions, {
    fields: [quotationLines.revisionId],
    references: [quotationRevisions.id],
  }),
  product: one(products, { fields: [quotationLines.productId], references: [products.id] }),
}));

export const quotationActivitiesRelations = relations(quotationActivities, ({ one }) => ({
  quotation: one(quotations, {
    fields: [quotationActivities.quotationId],
    references: [quotations.id],
  }),
}));

export const quotationAttachmentsRelations = relations(quotationAttachments, ({ one }) => ({
  quotation: one(quotations, {
    fields: [quotationAttachments.quotationId],
    references: [quotations.id],
  }),
}));

// --- Phase 7 — EPC project execution (ADR 0036) ----------------------

export const projectMilestonesRelations = relations(projectMilestones, ({ one }) => ({
  tenant: one(tenants, { fields: [projectMilestones.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [projectMilestones.projectId], references: [projects.id] }),
}));

export const projectInstallationsRelations = relations(projectInstallations, ({ one }) => ({
  tenant: one(tenants, { fields: [projectInstallations.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [projectInstallations.projectId], references: [projects.id] }),
  assignee: one(userTenantMemberships, {
    fields: [projectInstallations.assignedMembershipId],
    references: [userTenantMemberships.id],
  }),
  visit: one(visits, { fields: [projectInstallations.visitId], references: [visits.id] }),
}));

export const projectChecklistItemsRelations = relations(projectChecklistItems, ({ one }) => ({
  tenant: one(tenants, { fields: [projectChecklistItems.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [projectChecklistItems.projectId], references: [projects.id] }),
  inspection: one(projectQcInspections, {
    fields: [projectChecklistItems.inspectionId],
    references: [projectQcInspections.id],
  }),
}));

export const projectQcInspectionsRelations = relations(projectQcInspections, ({ one, many }) => ({
  tenant: one(tenants, { fields: [projectQcInspections.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [projectQcInspections.projectId], references: [projects.id] }),
  checklist: many(projectChecklistItems),
  defects: many(projectDefects),
}));

export const projectDefectsRelations = relations(projectDefects, ({ one }) => ({
  tenant: one(tenants, { fields: [projectDefects.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [projectDefects.projectId], references: [projects.id] }),
  inspection: one(projectQcInspections, {
    fields: [projectDefects.inspectionId],
    references: [projectQcInspections.id],
  }),
  assignee: one(userTenantMemberships, {
    fields: [projectDefects.assignedMembershipId],
    references: [userTenantMemberships.id],
  }),
}));

export const projectNetMeteringRelations = relations(projectNetMetering, ({ one }) => ({
  tenant: one(tenants, { fields: [projectNetMetering.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [projectNetMetering.projectId], references: [projects.id] }),
}));

export const projectHandoverRelations = relations(projectHandover, ({ one }) => ({
  tenant: one(tenants, { fields: [projectHandover.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [projectHandover.projectId], references: [projects.id] }),
}));

export const projectExecutionAttachmentsRelations = relations(
  projectExecutionAttachments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [projectExecutionAttachments.tenantId],
      references: [tenants.id],
    }),
    project: one(projects, {
      fields: [projectExecutionAttachments.projectId],
      references: [projects.id],
    }),
  }),
);

// Phase 8 — Notifications & Communications Engine (ADR 0037).

export const notificationTemplatesRelations = relations(notificationTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [notificationTemplates.tenantId], references: [tenants.id] }),
}));

export const notificationRulesRelations = relations(notificationRules, ({ one }) => ({
  tenant: one(tenants, { fields: [notificationRules.tenantId], references: [tenants.id] }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  tenant: one(tenants, { fields: [notificationPreferences.tenantId], references: [tenants.id] }),
  membership: one(userTenantMemberships, {
    fields: [notificationPreferences.membershipId],
    references: [userTenantMemberships.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one, many }) => ({
  tenant: one(tenants, { fields: [notifications.tenantId], references: [tenants.id] }),
  recipient: one(userTenantMemberships, {
    fields: [notifications.recipientMembershipId],
    references: [userTenantMemberships.id],
  }),
  deliveries: many(notificationDeliveries),
}));

export const notificationDeliveriesRelations = relations(notificationDeliveries, ({ one }) => ({
  tenant: one(tenants, { fields: [notificationDeliveries.tenantId], references: [tenants.id] }),
  notification: one(notifications, {
    fields: [notificationDeliveries.notificationId],
    references: [notifications.id],
  }),
}));

// Phase 9 — Finance: operational invoicing & payments (ADR 0038).

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  tenant: one(tenants, { fields: [invoices.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  project: one(projects, { fields: [invoices.projectId], references: [projects.id] }),
  quotation: one(quotations, { fields: [invoices.quotationId], references: [quotations.id] }),
  lines: many(invoiceLines),
  allocations: many(paymentAllocations),
  creditNotes: many(creditNotes),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  tenant: one(tenants, { fields: [invoiceLines.tenantId], references: [tenants.id] }),
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [payments.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [payments.customerId], references: [customers.id] }),
  allocations: many(paymentAllocations),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentAllocations.tenantId], references: [tenants.id] }),
  payment: one(payments, { fields: [paymentAllocations.paymentId], references: [payments.id] }),
  invoice: one(invoices, { fields: [paymentAllocations.invoiceId], references: [invoices.id] }),
}));

export const creditNotesRelations = relations(creditNotes, ({ one }) => ({
  tenant: one(tenants, { fields: [creditNotes.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [creditNotes.customerId], references: [customers.id] }),
  invoice: one(invoices, { fields: [creditNotes.invoiceId], references: [invoices.id] }),
}));

// Phase 10 — Tenant company profile, branding & onboarding (ADR 0039).

export const tenantCompanyProfilesRelations = relations(tenantCompanyProfiles, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantCompanyProfiles.tenantId], references: [tenants.id] }),
}));

export const tenantAssetsRelations = relations(tenantAssets, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantAssets.tenantId], references: [tenants.id] }),
}));

export const tenantOnboardingRelations = relations(tenantOnboarding, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantOnboarding.tenantId], references: [tenants.id] }),
}));
