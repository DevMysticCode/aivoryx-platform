import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';

/**
 * HR & Workforce Management (Phase 12, ADR 0041).
 *
 * A BOUNDED domain module. It builds ON platform core (identity, tenancy,
 * RBAC, audit, notifications, outbox, object storage, the document engine) but
 * owns NO cross-module foreign keys into CRM / Field / Supply / EPC / Finance
 * tables — so HR could later be extracted into a separately deployed
 * application without a schema rewrite. Where a claim references a field visit
 * or a project, only the opaque UUID is stored (a soft reference, tenant-scoped
 * by the row's own `tenant_id`); existence is validated through a narrow
 * capability contract, not a database FK.
 *
 * Identity vs Employee: the platform's `users` / `user_tenant_memberships`
 * remain authoritative for authentication. An `employees` row MAY link to a
 * membership (`membership_id`) but never duplicates a password, session, role
 * or permission. An employee can exist without a login; a user can exist
 * without an employee.
 *
 * Money is PostgreSQL NUMERIC (never JS floats); callers do fixed-point decimal
 * math on strings via `apps/api/src/supply/decimal.ts`. Historical HR records
 * (employment history, finalized compensation, finalized payroll, reimbursed
 * claims) are immutable — corrections are explicit new rows, never overwrites.
 *
 * Sensitive data (`employee_bank_details`, compensation) is protected by
 * dedicated narrow permissions + masked DTOs + tenant RLS; it never appears in
 * list DTOs, audit metadata, notification payloads or logs.
 */

const MONEY = { precision: 18, scale: 2 } as const;
const QUOTA = { precision: 9, scale: 2 } as const;
const RATE = { precision: 12, scale: 4 } as const;

const ts = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// ---- enums ---------------------------------------------------------

export const employeeStatus = pgEnum('hr_employee_status', [
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'TERMINATED',
  'RESIGNED',
  'INACTIVE',
]);

export const employmentType = pgEnum('hr_employment_type', [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERN',
  'TEMPORARY',
]);

export const orgUnitStatus = pgEnum('hr_org_unit_status', ['ACTIVE', 'ARCHIVED']);

export const employmentChangeType = pgEnum('hr_employment_change_type', [
  'DEPARTMENT',
  'DESIGNATION',
  'MANAGER',
  'LOCATION',
  'EMPLOYMENT_TYPE',
  'STATUS',
  'SCHEDULE',
  'COMPENSATION',
]);

export const attendanceStatus = pgEnum('hr_attendance_status', [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LATE',
  'EARLY_DEPARTURE',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKEND',
  'OTHER',
]);

export const attendanceSource = pgEnum('hr_attendance_source', [
  'WEB',
  'MOBILE',
  'ADMIN',
  'IMPORT',
  'INTEGRATION',
]);

export const halfDayPeriod = pgEnum('hr_half_day_period', ['FIRST_HALF', 'SECOND_HALF']);

export const leaveApproverStrategy = pgEnum('hr_leave_approver_strategy', [
  'REPORTING_MANAGER',
  'HR',
  'DESIGNATED_APPROVER',
  'TENANT_ADMIN',
]);

export const leaveRequestStatus = pgEnum('hr_leave_request_status', [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const leaveBalanceTxnKind = pgEnum('hr_leave_balance_txn_kind', [
  'OPENING',
  'ACCRUAL',
  'CONSUMPTION',
  'ADJUSTMENT',
  'REVERSAL',
]);

export const expenseClaimStatus = pgEnum('hr_expense_claim_status', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'REIMBURSEMENT_PENDING',
  'REIMBURSED',
  'REIMBURSEMENT_FAILED',
  'CANCELLED',
]);

export const reimbursementStatus = pgEnum('hr_reimbursement_status', ['PENDING', 'PAID', 'FAILED']);

/** Generic, vendor-neutral — mirrors the finance enum but is HR-owned so the
 *  module stays extractable. No payment-gateway coupling. */
export const hrPaymentMethod = pgEnum('hr_payment_method', [
  'BANK_TRANSFER',
  'CASH',
  'CARD',
  'CHEQUE',
  'UPI',
  'OTHER',
]);

export const payFrequency = pgEnum('hr_pay_frequency', ['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL']);

export const compensationStatus = pgEnum('hr_compensation_status', ['ACTIVE', 'SUPERSEDED']);

/** Generic salary/payroll component kinds — NEVER country-specific statutory
 *  components (PF / ESI / PAYE / EPF / SOCSO …). Those belong in future
 *  country-specific payroll engines. */
export const salaryComponentKind = pgEnum('hr_salary_component_kind', [
  'EARNING',
  'DEDUCTION',
  'INCENTIVE',
  'REIMBURSEMENT',
]);

export const payrollPeriodStatus = pgEnum('hr_payroll_period_status', [
  'DRAFT',
  'PROCESSING',
  'FINALIZED',
  'PAYMENT_PROCESSING',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
]);

export const payrollPaymentStatus = pgEnum('hr_payroll_payment_status', [
  'PENDING',
  'PAID',
  'PARTIALLY_PAID',
  'FAILED',
]);

export const incentiveStatus = pgEnum('hr_incentive_status', [
  'DRAFT',
  'APPROVED',
  'REJECTED',
  'PAID',
]);

export const performancePeriodStatus = pgEnum('hr_performance_period_status', [
  'DRAFT',
  'OPEN',
  'CLOSED',
]);

export const performanceGoalStatus = pgEnum('hr_performance_goal_status', [
  'OPEN',
  'ACHIEVED',
  'MISSED',
  'CANCELLED',
]);

export const performanceReviewStatus = pgEnum('hr_performance_review_status', [
  'DRAFT',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'CLOSED',
]);

// ---- generic tenant-scoped numbering (HR-owned) --------------------

/** One row per (tenant, kind). Human numbers are `${prefix}${value padded}`
 *  (e.g. `EMP-000001`, `LR-000001`, `EXP-000001`). Incremented atomically
 *  inside the creating transaction, so concurrent creates never collide. */
export const hrCounters = pgTable(
  'hr_counters',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    prefix: text('prefix').notNull(),
    padding: integer('padding').notNull().default(6),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    ...ts,
  },
  (t) => [unique('hr_counters_tenant_kind_uq').on(t.tenantId, t.kind)],
);

// ---- organisation ------------------------------------------------

export const departments = pgTable(
  'hr_departments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    status: orgUnitStatus('status').notNull().default('ACTIVE'),
    ...ts,
  },
  (t) => [
    unique('hr_departments_tenant_code_uq').on(t.tenantId, t.code),
    unique('hr_departments_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_departments_tenant_idx').on(t.tenantId),
  ],
);

export const designations = pgTable(
  'hr_designations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    status: orgUnitStatus('status').notNull().default('ACTIVE'),
    ...ts,
  },
  (t) => [
    unique('hr_designations_tenant_code_uq').on(t.tenantId, t.code),
    unique('hr_designations_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_designations_tenant_idx').on(t.tenantId),
  ],
);

export const workLocations = pgTable(
  'hr_work_locations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    addressLine: text('address_line'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    postalCode: text('postal_code'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    status: orgUnitStatus('status').notNull().default('ACTIVE'),
    ...ts,
  },
  (t) => [
    unique('hr_work_locations_tenant_code_uq').on(t.tenantId, t.code),
    unique('hr_work_locations_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_work_locations_tenant_idx').on(t.tenantId),
  ],
);

export const workSchedules = pgTable(
  'hr_work_schedules',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** local time-of-day, `HH:MM` */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    /** bitmask, bit 0 = Monday … bit 6 = Sunday; default 31 = Mon–Fri */
    workingDaysMask: integer('working_days_mask').notNull().default(31),
    graceMinutes: integer('grace_minutes').notNull().default(0),
    locationId: uuid('location_id'),
    status: orgUnitStatus('status').notNull().default('ACTIVE'),
    ...ts,
  },
  (t) => [
    unique('hr_work_schedules_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_work_schedules_tenant_idx').on(t.tenantId),
    check(
      'hr_work_schedules_time_fmt',
      sql`"start_time" ~ '^\\d{2}:\\d{2}$' and "end_time" ~ '^\\d{2}:\\d{2}$'`,
    ),
    check('hr_work_schedules_grace_nonneg', sql`"grace_minutes" >= 0`),
    foreignKey({
      name: 'hr_work_schedules_location_fk',
      columns: [t.locationId, t.tenantId],
      foreignColumns: [workLocations.id, workLocations.tenantId],
    }).onDelete('set null'),
  ],
);

// ---- employees --------------------------------------------------

export const employees = pgTable(
  'hr_employees',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeNumber: text('employee_number').notNull(),
    firstName: text('first_name').notNull(),
    middleName: text('middle_name'),
    lastName: text('last_name').notNull(),
    displayName: text('display_name').notNull(),
    workEmail: text('work_email'),
    personalEmail: text('personal_email'),
    phone: text('phone'),
    addressLine: text('address_line'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    postalCode: text('postal_code'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    emergencyContactRelation: text('emergency_contact_relation'),
    joiningDate: date('joining_date').notNull(),
    status: employeeStatus('status').notNull().default('ACTIVE'),
    employmentType: employmentType('employment_type').notNull().default('FULL_TIME'),
    departmentId: uuid('department_id'),
    designationId: uuid('designation_id'),
    workLocationId: uuid('work_location_id'),
    managerId: uuid('manager_id'),
    scheduleId: uuid('schedule_id'),
    /** optional free-text tenant categorisation (not hardcoded) */
    category: text('category'),
    probationEndDate: date('probation_end_date'),
    /** optional link to an Aivoryx login for this tenant — never duplicates auth */
    membershipId: uuid('membership_id'),
    photoObjectKey: text('photo_object_key'),
    notes: text('notes'),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    terminationReason: text('termination_reason'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_employees_tenant_number_uq').on(t.tenantId, t.employeeNumber),
    unique('hr_employees_id_tenant_uq').on(t.id, t.tenantId),
    // at most one active identity mapping per membership, per tenant
    unique('hr_employees_tenant_membership_uq').on(t.tenantId, t.membershipId),
    index('hr_employees_tenant_status_idx').on(t.tenantId, t.status),
    index('hr_employees_tenant_dept_idx').on(t.tenantId, t.departmentId),
    index('hr_employees_tenant_manager_idx').on(t.tenantId, t.managerId),
    check('hr_employees_self_manager', sql`"manager_id" is null or "manager_id" <> "id"`),
    foreignKey({
      name: 'hr_employees_department_fk',
      columns: [t.departmentId, t.tenantId],
      foreignColumns: [departments.id, departments.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'hr_employees_designation_fk',
      columns: [t.designationId, t.tenantId],
      foreignColumns: [designations.id, designations.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'hr_employees_location_fk',
      columns: [t.workLocationId, t.tenantId],
      foreignColumns: [workLocations.id, workLocations.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'hr_employees_manager_fk',
      columns: [t.managerId, t.tenantId],
      foreignColumns: [t.id, t.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'hr_employees_schedule_fk',
      columns: [t.scheduleId, t.tenantId],
      foreignColumns: [workSchedules.id, workSchedules.tenantId],
    }).onDelete('set null'),
    // the membership must belong to THIS tenant — cross-tenant link impossible
    foreignKey({
      name: 'hr_employees_membership_fk',
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

/** Immutable, effective-dated log of the changes that matter for HR history. */
export const employmentHistory = pgTable(
  'hr_employment_history',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    changeType: employmentChangeType('change_type').notNull(),
    effectiveDate: date('effective_date').notNull(),
    /** safe, non-sensitive summary values — never salary figures for COMPENSATION */
    fromValue: jsonb('from_value').$type<Record<string, unknown> | null>(),
    toValue: jsonb('to_value').$type<Record<string, unknown> | null>(),
    reason: text('reason'),
    changedByMembershipId: uuid('changed_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('hr_employment_history_emp_idx').on(t.tenantId, t.employeeId, t.effectiveDate),
    foreignKey({
      name: 'hr_employment_history_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

/** Highly sensitive. Gated by `hr.bank_details.*`; account number is masked in
 *  every DTO and never enters audit metadata, notifications or logs. */
export const employeeBankDetails = pgTable(
  'hr_employee_bank_details',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    accountHolderName: text('account_holder_name').notNull(),
    bankName: text('bank_name'),
    accountNumber: text('account_number').notNull(),
    branch: text('branch'),
    /** local bank identifier (IFSC / sort code / routing …) — never mandatory */
    bankIdentifier: text('bank_identifier'),
    swiftBic: text('swift_bic'),
    preferredMethod: hrPaymentMethod('preferred_method').notNull().default('BANK_TRANSFER'),
    updatedByMembershipId: uuid('updated_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_employee_bank_details_employee_uq').on(t.tenantId, t.employeeId),
    unique('hr_employee_bank_details_id_tenant_uq').on(t.id, t.tenantId),
    foreignKey({
      name: 'hr_employee_bank_details_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

export const employeeDocuments = pgTable(
  'hr_employee_documents',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    originalFilename: text('original_filename'),
    uploadedByMembershipId: uuid('uploaded_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('hr_employee_documents_object_key_uq').on(t.objectKey),
    index('hr_employee_documents_emp_idx').on(t.tenantId, t.employeeId),
    check('hr_employee_documents_size_pos', sql`"size_bytes" > 0`),
    foreignKey({
      name: 'hr_employee_documents_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

// ---- attendance -----------------------------------------------

export const attendanceRecords = pgTable(
  'hr_attendance_records',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    status: attendanceStatus('status').notNull().default('PRESENT'),
    checkInAt: timestamp('check_in_at', { withTimezone: true }),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    checkInLat: numeric('check_in_lat', { precision: 9, scale: 6 }),
    checkInLng: numeric('check_in_lng', { precision: 9, scale: 6 }),
    checkInAccuracyM: numeric('check_in_accuracy_m', { precision: 9, scale: 2 }),
    checkOutLat: numeric('check_out_lat', { precision: 9, scale: 6 }),
    checkOutLng: numeric('check_out_lng', { precision: 9, scale: 6 }),
    checkOutAccuracyM: numeric('check_out_accuracy_m', { precision: 9, scale: 2 }),
    /** straight-line GPS distance from the work location at check-in, metres —
     *  NOT road/travel distance, NOT proof of physical presence */
    gpsDistanceM: numeric('gps_distance_m', { precision: 12, scale: 2 }),
    source: attendanceSource('source').notNull().default('WEB'),
    notes: text('notes'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    // one record per employee per day — prevents overlapping sessions by design
    unique('hr_attendance_records_emp_date_uq').on(t.tenantId, t.employeeId, t.workDate),
    unique('hr_attendance_records_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_attendance_records_tenant_date_idx').on(t.tenantId, t.workDate),
    index('hr_attendance_records_emp_idx').on(t.tenantId, t.employeeId, t.workDate),
    check(
      'hr_attendance_records_checkout_after_checkin',
      sql`"check_out_at" is null or ("check_in_at" is not null and "check_out_at" >= "check_in_at")`,
    ),
    foreignKey({
      name: 'hr_attendance_records_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

/** Every HR/admin correction is an immutable record of the original + new
 *  value; the attendance row is never silently overwritten. */
export const attendanceCorrections = pgTable(
  'hr_attendance_corrections',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    attendanceRecordId: uuid('attendance_record_id').notNull(),
    field: text('field').notNull(),
    originalValue: jsonb('original_value').$type<unknown>(),
    correctedValue: jsonb('corrected_value').$type<unknown>(),
    reason: text('reason').notNull(),
    correctedByMembershipId: uuid('corrected_by_membership_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('hr_attendance_corrections_rec_idx').on(t.tenantId, t.attendanceRecordId),
    foreignKey({
      name: 'hr_attendance_corrections_record_fk',
      columns: [t.attendanceRecordId, t.tenantId],
      foreignColumns: [attendanceRecords.id, attendanceRecords.tenantId],
    }).onDelete('cascade'),
  ],
);

// ---- leave -----------------------------------------------------

export const leaveTypes = pgTable(
  'hr_leave_types',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    isPaid: boolean('is_paid').notNull().default(true),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    allowNegativeBalance: boolean('allow_negative_balance').notNull().default(false),
    status: orgUnitStatus('status').notNull().default('ACTIVE'),
    ...ts,
  },
  (t) => [
    unique('hr_leave_types_tenant_code_uq').on(t.tenantId, t.code),
    unique('hr_leave_types_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_leave_types_tenant_idx').on(t.tenantId),
  ],
);

export const leavePolicies = pgTable(
  'hr_leave_policies',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id').notNull(),
    name: text('name').notNull(),
    annualQuota: numeric('annual_quota', QUOTA).notNull().default('0'),
    approverStrategy: leaveApproverStrategy('approver_strategy')
      .notNull()
      .default('REPORTING_MANAGER'),
    designatedApproverMembershipId: uuid('designated_approver_membership_id'),
    status: orgUnitStatus('status').notNull().default('ACTIVE'),
    ...ts,
  },
  (t) => [
    unique('hr_leave_policies_tenant_type_uq').on(t.tenantId, t.leaveTypeId),
    unique('hr_leave_policies_id_tenant_uq').on(t.id, t.tenantId),
    check('hr_leave_policies_quota_nonneg', sql`"annual_quota" >= 0`),
    foreignKey({
      name: 'hr_leave_policies_type_fk',
      columns: [t.leaveTypeId, t.tenantId],
      foreignColumns: [leaveTypes.id, leaveTypes.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hr_leave_policies_approver_fk',
      columns: [t.designatedApproverMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

/** `balance` is a generated column: opening + accrued + adjusted − consumed. It
 *  is recomputed by PostgreSQL from the ledger columns, so it can never drift. */
export const leaveBalances = pgTable(
  'hr_leave_balances',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    year: integer('year').notNull(),
    opening: numeric('opening', QUOTA).notNull().default('0'),
    accrued: numeric('accrued', QUOTA).notNull().default('0'),
    consumed: numeric('consumed', QUOTA).notNull().default('0'),
    adjusted: numeric('adjusted', QUOTA).notNull().default('0'),
    balance: numeric('balance', QUOTA).generatedAlwaysAs(
      sql`"opening" + "accrued" + "adjusted" - "consumed"`,
    ),
    ...ts,
  },
  (t) => [
    unique('hr_leave_balances_uq').on(t.tenantId, t.employeeId, t.leaveTypeId, t.year),
    index('hr_leave_balances_emp_idx').on(t.tenantId, t.employeeId),
    check('hr_leave_balances_consumed_nonneg', sql`"consumed" >= 0 and "accrued" >= 0`),
    foreignKey({
      name: 'hr_leave_balances_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hr_leave_balances_type_fk',
      columns: [t.leaveTypeId, t.tenantId],
      foreignColumns: [leaveTypes.id, leaveTypes.tenantId],
    }).onDelete('cascade'),
  ],
);

export const leaveRequests = pgTable(
  'hr_leave_requests',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestNumber: text('request_number').notNull(),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isHalfDay: boolean('is_half_day').notNull().default(false),
    halfDayPeriod: halfDayPeriod('half_day_period'),
    totalDays: numeric('total_days', { precision: 6, scale: 2 }).notNull(),
    reason: text('reason'),
    notes: text('notes'),
    status: leaveRequestStatus('status').notNull().default('PENDING'),
    attachmentObjectKey: text('attachment_object_key'),
    /** resolved from the leave policy + employee hierarchy at submit time */
    approverMembershipId: uuid('approver_membership_id'),
    decidedByMembershipId: uuid('decided_by_membership_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_leave_requests_tenant_number_uq').on(t.tenantId, t.requestNumber),
    unique('hr_leave_requests_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_leave_requests_emp_idx').on(t.tenantId, t.employeeId, t.status),
    index('hr_leave_requests_queue_idx').on(t.tenantId, t.status, t.startDate),
    check('hr_leave_requests_dates', sql`"end_date" >= "start_date"`),
    check('hr_leave_requests_days_pos', sql`"total_days" > 0`),
    foreignKey({
      name: 'hr_leave_requests_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hr_leave_requests_type_fk',
      columns: [t.leaveTypeId, t.tenantId],
      foreignColumns: [leaveTypes.id, leaveTypes.tenantId],
    }).onDelete('restrict'),
  ],
);

/** Ledger-style balance changes. `consumed`/`accrued`/etc. on `leave_balances`
 *  are the sum of these; approved leave writes a signed CONSUMPTION row inside
 *  the same locked transaction that flips the request to APPROVED. */
export const leaveBalanceTransactions = pgTable(
  'hr_leave_balance_transactions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    year: integer('year').notNull(),
    kind: leaveBalanceTxnKind('kind').notNull(),
    amount: numeric('amount', QUOTA).notNull(),
    leaveRequestId: uuid('leave_request_id'),
    reason: text('reason'),
    createdByMembershipId: uuid('created_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('hr_leave_balance_txn_idx').on(t.tenantId, t.employeeId, t.leaveTypeId),
    foreignKey({
      name: 'hr_leave_balance_txn_request_fk',
      columns: [t.leaveRequestId, t.tenantId],
      foreignColumns: [leaveRequests.id, leaveRequests.tenantId],
    }).onDelete('set null'),
  ],
);

// ---- expenses ------------------------------------------------

export const expenseCategories = pgTable(
  'hr_expense_categories',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    /** if set, this category is a mileage category and claims compute
     *  reimbursement as distance_km × rate; tenant-configurable, never a
     *  country-specific assumption */
    defaultMileageRate: numeric('default_mileage_rate', RATE),
    requiresReceipt: boolean('requires_receipt').notNull().default(true),
    status: orgUnitStatus('status').notNull().default('ACTIVE'),
    ...ts,
  },
  (t) => [
    unique('hr_expense_categories_tenant_code_uq').on(t.tenantId, t.code),
    unique('hr_expense_categories_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_expense_categories_tenant_idx').on(t.tenantId),
  ],
);

export const expenseClaims = pgTable(
  'hr_expense_claims',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    claimNumber: text('claim_number').notNull(),
    employeeId: uuid('employee_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    claimDate: date('claim_date').notNull(),
    expenseDate: date('expense_date').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    currency: text('currency').notNull().default('INR'),
    description: text('description'),
    merchant: text('merchant'),
    /** SOFT references — opaque tenant-scoped UUIDs, NO FK into Field/Supply, so
     *  HR stays independently extractable (ADR 0041). Existence is a narrow
     *  capability concern, not a schema concern. */
    projectRef: uuid('project_ref'),
    visitRef: uuid('visit_ref'),
    /** mileage evidence (from the Field visit or entered manually) — separate
     *  from the financial reimbursement figure */
    distanceKm: numeric('distance_km', { precision: 9, scale: 2 }),
    mileageRate: numeric('mileage_rate', RATE),
    /** frozen at approval: mileage → distance×rate, otherwise = amount */
    reimbursementAmount: numeric('reimbursement_amount', MONEY),
    approvedAmount: numeric('approved_amount', MONEY),
    receiptObjectKey: text('receipt_object_key'),
    notes: text('notes'),
    status: expenseClaimStatus('status').notNull().default('DRAFT'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approverMembershipId: uuid('approver_membership_id'),
    decidedByMembershipId: uuid('decided_by_membership_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_expense_claims_tenant_number_uq').on(t.tenantId, t.claimNumber),
    unique('hr_expense_claims_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_expense_claims_emp_idx').on(t.tenantId, t.employeeId, t.status),
    index('hr_expense_claims_queue_idx').on(t.tenantId, t.status, t.claimDate),
    index('hr_expense_claims_visit_idx').on(t.tenantId, t.visitRef),
    check('hr_expense_claims_amount_pos', sql`"amount" > 0`),
    check('hr_expense_claims_currency_iso', sql`"currency" ~ '^[A-Z]{3}$'`),
    foreignKey({
      name: 'hr_expense_claims_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hr_expense_claims_category_fk',
      columns: [t.categoryId, t.tenantId],
      foreignColumns: [expenseCategories.id, expenseCategories.tenantId],
    }).onDelete('restrict'),
  ],
);

/** Records the actual reimbursement/payment against an approved claim. HR owns
 *  "I incurred it and am owed it"; a future Finance adapter can consume the
 *  approved claim through a narrow contract without changing this table. */
export const expenseReimbursements = pgTable(
  'hr_expense_reimbursements',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    expenseClaimId: uuid('expense_claim_id').notNull(),
    reimbursedAmount: numeric('reimbursed_amount', MONEY).notNull(),
    currency: text('currency').notNull().default('INR'),
    paymentDate: date('payment_date'),
    paymentMethod: hrPaymentMethod('payment_method'),
    paymentReference: text('payment_reference'),
    transactionRef: text('transaction_ref'),
    status: reimbursementStatus('status').notNull().default('PENDING'),
    failureReason: text('failure_reason'),
    processedByMembershipId: uuid('processed_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_expense_reimbursements_claim_uq').on(t.tenantId, t.expenseClaimId),
    unique('hr_expense_reimbursements_id_tenant_uq').on(t.id, t.tenantId),
    check('hr_expense_reimbursements_amount_nonneg', sql`"reimbursed_amount" >= 0`),
    foreignKey({
      name: 'hr_expense_reimbursements_claim_fk',
      columns: [t.expenseClaimId, t.tenantId],
      foreignColumns: [expenseClaims.id, expenseClaims.tenantId],
    }).onDelete('cascade'),
  ],
);

// ---- compensation & payroll ---------------------------------

export const compensationProfiles = pgTable(
  'hr_compensation_profiles',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    effectiveDate: date('effective_date').notNull(),
    payFrequency: payFrequency('pay_frequency').notNull().default('MONTHLY'),
    currency: text('currency').notNull().default('INR'),
    baseSalary: numeric('base_salary', MONEY).notNull(),
    status: compensationStatus('status').notNull().default('ACTIVE'),
    notes: text('notes'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_compensation_profiles_id_tenant_uq').on(t.id, t.tenantId),
    unique('hr_compensation_profiles_emp_date_uq').on(t.tenantId, t.employeeId, t.effectiveDate),
    index('hr_compensation_profiles_emp_idx').on(t.tenantId, t.employeeId, t.effectiveDate),
    check('hr_compensation_profiles_base_nonneg', sql`"base_salary" >= 0`),
    check('hr_compensation_profiles_currency_iso', sql`"currency" ~ '^[A-Z]{3}$'`),
    foreignKey({
      name: 'hr_compensation_profiles_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

export const compensationComponents = pgTable(
  'hr_compensation_components',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    compensationProfileId: uuid('compensation_profile_id').notNull(),
    kind: salaryComponentKind('kind').notNull(),
    name: text('name').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('hr_compensation_components_profile_idx').on(t.tenantId, t.compensationProfileId),
    check('hr_compensation_components_amount_nonneg', sql`"amount" >= 0`),
    foreignKey({
      name: 'hr_compensation_components_profile_fk',
      columns: [t.compensationProfileId, t.tenantId],
      foreignColumns: [compensationProfiles.id, compensationProfiles.tenantId],
    }).onDelete('cascade'),
  ],
);

export const incentives = pgTable(
  'hr_incentives',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    currency: text('currency').notNull().default('INR'),
    /** free-text, tenant-defined (e.g. "performance", "referral") — never a
     *  hardcoded sales-commission / installation-bonus concept */
    type: text('type').notNull(),
    reason: text('reason'),
    /** opaque reference supplied by another module through a narrow contract */
    sourceRef: text('source_ref'),
    status: incentiveStatus('status').notNull().default('DRAFT'),
    payrollPeriodId: uuid('payroll_period_id'),
    approvedByMembershipId: uuid('approved_by_membership_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_incentives_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_incentives_emp_idx').on(t.tenantId, t.employeeId, t.status),
    check('hr_incentives_amount_pos', sql`"amount" > 0`),
    foreignKey({
      name: 'hr_incentives_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

export const payrollPeriods = pgTable(
  'hr_payroll_periods',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    payDate: date('pay_date'),
    currency: text('currency').notNull().default('INR'),
    status: payrollPeriodStatus('status').notNull().default('DRAFT'),
    grossTotal: numeric('gross_total', MONEY).notNull().default('0'),
    deductionTotal: numeric('deduction_total', MONEY).notNull().default('0'),
    incentiveTotal: numeric('incentive_total', MONEY).notNull().default('0'),
    reimbursementTotal: numeric('reimbursement_total', MONEY).notNull().default('0'),
    netTotal: numeric('net_total', MONEY).notNull().default('0'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    finalizedByMembershipId: uuid('finalized_by_membership_id'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_payroll_periods_tenant_name_uq').on(t.tenantId, t.name),
    unique('hr_payroll_periods_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_payroll_periods_tenant_status_idx').on(t.tenantId, t.status),
    check('hr_payroll_periods_dates', sql`"period_end" >= "period_start"`),
    check('hr_payroll_periods_currency_iso', sql`"currency" ~ '^[A-Z]{3}$'`),
  ],
);

/** A finalized entry is an immutable snapshot: changing the employee's salary,
 *  department, leave or expenses afterwards never alters it. */
export const payrollEntries = pgTable(
  'hr_payroll_entries',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    payrollPeriodId: uuid('payroll_period_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    employeeNumber: text('employee_number').notNull(),
    employeeName: text('employee_name').notNull(),
    currency: text('currency').notNull().default('INR'),
    baseEarnings: numeric('base_earnings', MONEY).notNull().default('0'),
    allowancesTotal: numeric('allowances_total', MONEY).notNull().default('0'),
    incentivesTotal: numeric('incentives_total', MONEY).notNull().default('0'),
    reimbursementsTotal: numeric('reimbursements_total', MONEY).notNull().default('0'),
    deductionsTotal: numeric('deductions_total', MONEY).notNull().default('0'),
    grossPay: numeric('gross_pay', MONEY).notNull().default('0'),
    netPay: numeric('net_pay', MONEY).notNull().default('0'),
    /** full computed breakdown, frozen when the period is finalized */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
    paymentStatus: payrollPaymentStatus('payment_status').notNull().default('PENDING'),
    paidAmount: numeric('paid_amount', MONEY).notNull().default('0'),
    ...ts,
  },
  (t) => [
    unique('hr_payroll_entries_period_emp_uq').on(t.tenantId, t.payrollPeriodId, t.employeeId),
    unique('hr_payroll_entries_id_tenant_uq').on(t.id, t.tenantId),
    index('hr_payroll_entries_emp_idx').on(t.tenantId, t.employeeId),
    check('hr_payroll_entries_paid_nonneg', sql`"paid_amount" >= 0`),
    foreignKey({
      name: 'hr_payroll_entries_period_fk',
      columns: [t.payrollPeriodId, t.tenantId],
      foreignColumns: [payrollPeriods.id, payrollPeriods.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hr_payroll_entries_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('restrict'),
  ],
);

export const payrollEntryComponents = pgTable(
  'hr_payroll_entry_components',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    payrollEntryId: uuid('payroll_entry_id').notNull(),
    kind: salaryComponentKind('kind').notNull(),
    name: text('name').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    /** 'compensation' | 'incentive' | 'reimbursement' | 'manual' */
    source: text('source').notNull().default('compensation'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('hr_payroll_entry_components_entry_idx').on(t.tenantId, t.payrollEntryId),
    foreignKey({
      name: 'hr_payroll_entry_components_entry_fk',
      columns: [t.payrollEntryId, t.tenantId],
      foreignColumns: [payrollEntries.id, payrollEntries.tenantId],
    }).onDelete('cascade'),
  ],
);

/** Operational payment state only — Aivoryx is not a bank. Actual bank/payment
 *  integration is a future adapter. Multiple rows allow partial payments. */
export const payrollPayments = pgTable(
  'hr_payroll_payments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    payrollEntryId: uuid('payroll_entry_id').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    paymentMethod: hrPaymentMethod('payment_method').notNull().default('BANK_TRANSFER'),
    paymentDate: date('payment_date').notNull(),
    paymentReference: text('payment_reference'),
    transactionRef: text('transaction_ref'),
    status: reimbursementStatus('status').notNull().default('PAID'),
    failureReason: text('failure_reason'),
    processedByMembershipId: uuid('processed_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('hr_payroll_payments_entry_idx').on(t.tenantId, t.payrollEntryId),
    check('hr_payroll_payments_amount_pos', sql`"amount" > 0`),
    foreignKey({
      name: 'hr_payroll_payments_entry_fk',
      columns: [t.payrollEntryId, t.tenantId],
      foreignColumns: [payrollEntries.id, payrollEntries.tenantId],
    }).onDelete('cascade'),
  ],
);

// ---- performance --------------------------------------------

export const performancePeriods = pgTable(
  'hr_performance_periods',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: performancePeriodStatus('status').notNull().default('DRAFT'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_performance_periods_tenant_name_uq').on(t.tenantId, t.name),
    unique('hr_performance_periods_id_tenant_uq').on(t.id, t.tenantId),
    check('hr_performance_periods_dates', sql`"period_end" >= "period_start"`),
  ],
);

export const performanceGoals = pgTable(
  'hr_performance_goals',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    performancePeriodId: uuid('performance_period_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    weight: integer('weight'),
    status: performanceGoalStatus('status').notNull().default('OPEN'),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    index('hr_performance_goals_idx').on(t.tenantId, t.performancePeriodId, t.employeeId),
    foreignKey({
      name: 'hr_performance_goals_period_fk',
      columns: [t.performancePeriodId, t.tenantId],
      foreignColumns: [performancePeriods.id, performancePeriods.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hr_performance_goals_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

export const performanceReviews = pgTable(
  'hr_performance_reviews',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    performancePeriodId: uuid('performance_period_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    reviewerMembershipId: uuid('reviewer_membership_id'),
    overallRating: integer('overall_rating'),
    managerComments: text('manager_comments'),
    employeeComments: text('employee_comments'),
    status: performanceReviewStatus('status').notNull().default('DRAFT'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdByMembershipId: uuid('created_by_membership_id'),
    ...ts,
  },
  (t) => [
    unique('hr_performance_reviews_period_emp_uq').on(
      t.tenantId,
      t.performancePeriodId,
      t.employeeId,
    ),
    index('hr_performance_reviews_emp_idx').on(t.tenantId, t.employeeId),
    check(
      'hr_performance_reviews_rating',
      sql`"overall_rating" is null or ("overall_rating" between 1 and 5)`,
    ),
    foreignKey({
      name: 'hr_performance_reviews_period_fk',
      columns: [t.performancePeriodId, t.tenantId],
      foreignColumns: [performancePeriods.id, performancePeriods.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'hr_performance_reviews_employee_fk',
      columns: [t.employeeId, t.tenantId],
      foreignColumns: [employees.id, employees.tenantId],
    }).onDelete('cascade'),
  ],
);

// ---- row types --------------------------------------------------

export type HrCounterRow = typeof hrCounters.$inferSelect;
export type DepartmentRow = typeof departments.$inferSelect;
export type NewDepartmentRow = typeof departments.$inferInsert;
export type DesignationRow = typeof designations.$inferSelect;
export type NewDesignationRow = typeof designations.$inferInsert;
export type WorkLocationRow = typeof workLocations.$inferSelect;
export type NewWorkLocationRow = typeof workLocations.$inferInsert;
export type WorkScheduleRow = typeof workSchedules.$inferSelect;
export type NewWorkScheduleRow = typeof workSchedules.$inferInsert;
export type EmployeeRow = typeof employees.$inferSelect;
export type NewEmployeeRow = typeof employees.$inferInsert;
export type EmploymentHistoryRow = typeof employmentHistory.$inferSelect;
export type NewEmploymentHistoryRow = typeof employmentHistory.$inferInsert;
export type EmployeeBankDetailsRow = typeof employeeBankDetails.$inferSelect;
export type NewEmployeeBankDetailsRow = typeof employeeBankDetails.$inferInsert;
export type EmployeeDocumentRow = typeof employeeDocuments.$inferSelect;
export type NewEmployeeDocumentRow = typeof employeeDocuments.$inferInsert;
export type AttendanceRecordRow = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecordRow = typeof attendanceRecords.$inferInsert;
export type AttendanceCorrectionRow = typeof attendanceCorrections.$inferSelect;
export type NewAttendanceCorrectionRow = typeof attendanceCorrections.$inferInsert;
export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type NewLeaveTypeRow = typeof leaveTypes.$inferInsert;
export type LeavePolicyRow = typeof leavePolicies.$inferSelect;
export type NewLeavePolicyRow = typeof leavePolicies.$inferInsert;
export type LeaveBalanceRow = typeof leaveBalances.$inferSelect;
export type NewLeaveBalanceRow = typeof leaveBalances.$inferInsert;
export type LeaveRequestRow = typeof leaveRequests.$inferSelect;
export type NewLeaveRequestRow = typeof leaveRequests.$inferInsert;
export type LeaveBalanceTransactionRow = typeof leaveBalanceTransactions.$inferSelect;
export type NewLeaveBalanceTransactionRow = typeof leaveBalanceTransactions.$inferInsert;
export type ExpenseCategoryRow = typeof expenseCategories.$inferSelect;
export type NewExpenseCategoryRow = typeof expenseCategories.$inferInsert;
export type ExpenseClaimRow = typeof expenseClaims.$inferSelect;
export type NewExpenseClaimRow = typeof expenseClaims.$inferInsert;
export type ExpenseReimbursementRow = typeof expenseReimbursements.$inferSelect;
export type NewExpenseReimbursementRow = typeof expenseReimbursements.$inferInsert;
export type CompensationProfileRow = typeof compensationProfiles.$inferSelect;
export type NewCompensationProfileRow = typeof compensationProfiles.$inferInsert;
export type CompensationComponentRow = typeof compensationComponents.$inferSelect;
export type NewCompensationComponentRow = typeof compensationComponents.$inferInsert;
export type IncentiveRow = typeof incentives.$inferSelect;
export type NewIncentiveRow = typeof incentives.$inferInsert;
export type PayrollPeriodRow = typeof payrollPeriods.$inferSelect;
export type NewPayrollPeriodRow = typeof payrollPeriods.$inferInsert;
export type PayrollEntryRow = typeof payrollEntries.$inferSelect;
export type NewPayrollEntryRow = typeof payrollEntries.$inferInsert;
export type PayrollEntryComponentRow = typeof payrollEntryComponents.$inferSelect;
export type NewPayrollEntryComponentRow = typeof payrollEntryComponents.$inferInsert;
export type PayrollPaymentRow = typeof payrollPayments.$inferSelect;
export type NewPayrollPaymentRow = typeof payrollPayments.$inferInsert;
export type PerformancePeriodRow = typeof performancePeriods.$inferSelect;
export type NewPerformancePeriodRow = typeof performancePeriods.$inferInsert;
export type PerformanceGoalRow = typeof performanceGoals.$inferSelect;
export type NewPerformanceGoalRow = typeof performanceGoals.$inferInsert;
export type PerformanceReviewRow = typeof performanceReviews.$inferSelect;
export type NewPerformanceReviewRow = typeof performanceReviews.$inferInsert;
