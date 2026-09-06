import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';
import { projects } from './supply.js';
import { visits } from './field.js';

/**
 * EPC Project Execution (Phase 7, ADR 0036). Takes a booked/approved Phase 5
 * project through installation → QC → net metering → handover → completion.
 *
 * Built ON the existing platform — it EXTENDS the Phase 5 `projects` model
 * (no second project table), reuses `field_agents`/memberships for
 * installation assignment (no worker table), the Phase 3 custom-field-style
 * definition/value split for checklists, the object-storage adapter for
 * attachments, the transactional outbox for events, and `project_activities`
 * for the timeline.
 *
 * Detailed execution state lives in milestones + workflow records — the
 * `project_status` enum is deliberately NOT exploded (ADR 0036 §16).
 * Solar-specific concepts (net metering) are configurable workflow records,
 * never solar-only columns in the core project model.
 */

const entityTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// --- enums -----------------------------------------------------------

/** The high-level execution checklist. Kept as a fixed set of milestone keys
 *  rather than dozens of project statuses. */
export const projectMilestoneKey = pgEnum('project_milestone_key', [
  'PLANNING',
  'MATERIAL_READY',
  'INSTALLATION_SCHEDULED',
  'INSTALLATION_STARTED',
  'INSTALLATION_COMPLETED',
  'QC_PENDING',
  'QC_PASSED',
  'NET_METERING',
  'HANDOVER_READY',
  'HANDED_OVER',
  'COMPLETED',
]);

export const projectMilestoneStatus = pgEnum('project_milestone_status', [
  'pending',
  'in_progress',
  'done',
  'skipped',
  'blocked',
]);

export const installationStatus = pgEnum('installation_status', [
  'UNASSIGNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const checklistKind = pgEnum('checklist_kind', ['installation', 'qc', 'handover']);

export const checklistItemStatus = pgEnum('checklist_item_status', ['pending', 'done', 'na']);

export const qcInspectionStatus = pgEnum('qc_inspection_status', [
  'PENDING',
  'IN_PROGRESS',
  'PASSED',
  'FAILED',
]);

export const defectSeverity = pgEnum('defect_severity', ['low', 'medium', 'high', 'critical']);

export const defectStatus = pgEnum('defect_status', [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'VERIFIED',
]);

export const netMeteringStatus = pgEnum('net_metering_status', [
  'NOT_STARTED',
  'DOCUMENTS_PENDING',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
]);

export const handoverStatus = pgEnum('handover_status', ['PENDING', 'READY', 'COMPLETED']);

/** Which execution sub-entity an attachment belongs to (polymorphic, scoped by
 *  tenant + project). */
export const executionAttachmentEntity = pgEnum('execution_attachment_entity', [
  'installation',
  'qc',
  'defect',
  'net_metering',
  'handover',
]);

// --- project_milestones -------------------------------------------

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    key: projectMilestoneKey('key').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: projectMilestoneStatus('status').notNull().default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByMembershipId: uuid('completed_by_membership_id'),
    notes: text('notes'),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_milestones_tenant_project_key_uq').on(t.tenantId, t.projectId, t.key),
    unique('project_milestones_id_tenant_uq').on(t.id, t.tenantId),
    index('project_milestones_tenant_project_idx').on(t.tenantId, t.projectId),
    foreignKey({
      name: 'project_milestones_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_milestones_completed_by_fk',
      columns: [t.completedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- project_installations --------------------------------------

/**
 * One installation-assignment/workflow record per project. `assigned_membership_id`
 * points at an existing (field-agent) membership — no worker/employee table.
 * `material_override` lets an authorized user start installation before
 * material readiness is `READY` (ADR 0036 §4).
 */
export const projectInstallations = pgTable(
  'project_installations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    status: installationStatus('status').notNull().default('UNASSIGNED'),
    assignedMembershipId: uuid('assigned_membership_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    assignedByMembershipId: uuid('assigned_by_membership_id'),
    /** optional link to a scheduled Phase 4 field visit */
    visitId: uuid('visit_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    startLat: numeric('start_lat'),
    startLng: numeric('start_lng'),
    completeLat: numeric('complete_lat'),
    completeLng: numeric('complete_lng'),
    notes: text('notes'),
    equipmentInstalled: text('equipment_installed'),
    issues: text('issues'),
    materialOverride: boolean('material_override').notNull().default(false),
    materialOverrideByMembershipId: uuid('material_override_by_membership_id'),
    materialOverrideReason: text('material_override_reason'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_installations_tenant_project_uq').on(t.tenantId, t.projectId),
    unique('project_installations_id_tenant_uq').on(t.id, t.tenantId),
    index('project_installations_tenant_assignee_idx').on(
      t.tenantId,
      t.assignedMembershipId,
      t.status,
    ),
    foreignKey({
      name: 'project_installations_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_installations_assignee_fk',
      columns: [t.assignedMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'project_installations_visit_fk',
      columns: [t.visitId, t.tenantId],
      foreignColumns: [visits.id, visits.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'project_installations_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- checklist_templates (definitions — tenant-configurable) ----

export const checklistTemplates = pgTable(
  'checklist_templates',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: checklistKind('kind').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    required: boolean('required').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (t) => [
    unique('checklist_templates_tenant_kind_label_uq').on(t.tenantId, t.kind, t.label),
    index('checklist_templates_tenant_kind_idx').on(t.tenantId, t.kind, t.isActive),
  ],
);

// --- project_checklist_items (values — per project / per QC inspection) ----

export const projectChecklistItems = pgTable(
  'project_checklist_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    /** set only for `kind = 'qc'` items — they belong to one QC inspection */
    inspectionId: uuid('inspection_id'),
    /** the template this was copied from, when applicable */
    templateId: uuid('template_id'),
    kind: checklistKind('kind').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    required: boolean('required').notNull().default(true),
    status: checklistItemStatus('status').notNull().default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByMembershipId: uuid('completed_by_membership_id'),
    notes: text('notes'),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_checklist_items_id_tenant_uq').on(t.id, t.tenantId),
    index('project_checklist_items_tenant_project_kind_idx').on(t.tenantId, t.projectId, t.kind),
    index('project_checklist_items_tenant_inspection_idx').on(t.tenantId, t.inspectionId),
    foreignKey({
      name: 'project_checklist_items_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_checklist_items_completed_by_fk',
      columns: [t.completedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- project_qc_inspections -----------------------------------

export const projectQcInspections = pgTable(
  'project_qc_inspections',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    seq: integer('seq').notNull().default(1),
    status: qcInspectionStatus('status').notNull().default('PENDING'),
    inspectorMembershipId: uuid('inspector_membership_id'),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }),
    notes: text('notes'),
    resultNote: text('result_note'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_qc_inspections_tenant_project_seq_uq').on(t.tenantId, t.projectId, t.seq),
    unique('project_qc_inspections_id_tenant_uq').on(t.id, t.tenantId),
    index('project_qc_inspections_tenant_project_idx').on(t.tenantId, t.projectId, t.status),
    foreignKey({
      name: 'project_qc_inspections_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_qc_inspections_inspector_fk',
      columns: [t.inspectorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'project_qc_inspections_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- project_defects (lightweight defect list) ----------------

export const projectDefects = pgTable(
  'project_defects',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    /** the QC inspection that raised it, when applicable */
    inspectionId: uuid('inspection_id'),
    description: text('description').notNull(),
    severity: defectSeverity('severity').notNull().default('medium'),
    status: defectStatus('status').notNull().default('OPEN'),
    assignedMembershipId: uuid('assigned_membership_id'),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_defects_id_tenant_uq').on(t.id, t.tenantId),
    index('project_defects_tenant_project_status_idx').on(t.tenantId, t.projectId, t.status),
    index('project_defects_tenant_assignee_idx').on(t.tenantId, t.assignedMembershipId, t.status),
    foreignKey({
      name: 'project_defects_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_defects_inspection_fk',
      columns: [t.inspectionId, t.tenantId],
      foreignColumns: [projectQcInspections.id, projectQcInspections.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'project_defects_assignee_fk',
      columns: [t.assignedMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'project_defects_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- project_net_metering (internal grid-connection tracking) ---

export const projectNetMetering = pgTable(
  'project_net_metering',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    status: netMeteringStatus('status').notNull().default('NOT_STARTED'),
    /** true when this project does not need net metering at all */
    notRequired: boolean('not_required').notNull().default(false),
    referenceNumber: text('reference_number'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_net_metering_tenant_project_uq').on(t.tenantId, t.projectId),
    unique('project_net_metering_id_tenant_uq').on(t.id, t.tenantId),
    index('project_net_metering_tenant_status_idx').on(t.tenantId, t.status),
    foreignKey({
      name: 'project_net_metering_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_net_metering_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- project_handover ----------------------------------------

export const projectHandover = pgTable(
  'project_handover',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    status: handoverStatus('status').notNull().default('PENDING'),
    notes: text('notes'),
    /** V1: an internal recorded acknowledgement, NOT an e-signature */
    customerAcknowledged: boolean('customer_acknowledged').notNull().default(false),
    acknowledgedByName: text('acknowledged_by_name'),
    handoverAt: timestamp('handover_at', { withTimezone: true }),
    handedOverByMembershipId: uuid('handed_over_by_membership_id'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_handover_tenant_project_uq').on(t.tenantId, t.projectId),
    unique('project_handover_id_tenant_uq').on(t.id, t.tenantId),
    foreignKey({
      name: 'project_handover_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_handover_handed_over_by_fk',
      columns: [t.handedOverByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'project_handover_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- project_execution_attachments -------------------------

/** METADATA ONLY; bytes live in object storage. Polymorphic on
 *  `(entity_kind, entity_id)`, always scoped by tenant + project. */
export const projectExecutionAttachments = pgTable(
  'project_execution_attachments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    entityKind: executionAttachmentEntity('entity_kind').notNull(),
    entityId: uuid('entity_id').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename'),
    contentType: text('content_type').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    uploadedByMembershipId: uuid('uploaded_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('project_execution_attachments_object_key_uq').on(t.objectKey),
    index('project_execution_attachments_tenant_project_entity_idx').on(
      t.tenantId,
      t.projectId,
      t.entityKind,
      t.entityId,
    ),
    foreignKey({
      name: 'project_execution_attachments_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_execution_attachments_uploaded_by_fk',
      columns: [t.uploadedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- row types ---------------------------------------------

export type ProjectMilestoneRow = typeof projectMilestones.$inferSelect;
export type NewProjectMilestoneRow = typeof projectMilestones.$inferInsert;
export type ProjectInstallationRow = typeof projectInstallations.$inferSelect;
export type NewProjectInstallationRow = typeof projectInstallations.$inferInsert;
export type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
export type NewChecklistTemplateRow = typeof checklistTemplates.$inferInsert;
export type ProjectChecklistItemRow = typeof projectChecklistItems.$inferSelect;
export type NewProjectChecklistItemRow = typeof projectChecklistItems.$inferInsert;
export type ProjectQcInspectionRow = typeof projectQcInspections.$inferSelect;
export type NewProjectQcInspectionRow = typeof projectQcInspections.$inferInsert;
export type ProjectDefectRow = typeof projectDefects.$inferSelect;
export type NewProjectDefectRow = typeof projectDefects.$inferInsert;
export type ProjectNetMeteringRow = typeof projectNetMetering.$inferSelect;
export type NewProjectNetMeteringRow = typeof projectNetMetering.$inferInsert;
export type ProjectHandoverRow = typeof projectHandover.$inferSelect;
export type NewProjectHandoverRow = typeof projectHandover.$inferInsert;
export type ProjectExecutionAttachmentRow = typeof projectExecutionAttachments.$inferSelect;
export type NewProjectExecutionAttachmentRow = typeof projectExecutionAttachments.$inferInsert;
