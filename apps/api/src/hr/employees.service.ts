import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import {
  canTransitionEmployee,
  isTerminalEmployeeStatus,
  type EmployeeStatus,
} from './lifecycles.js';
import {
  HrScope,
  isFkViolation,
  isUniqueViolation,
  nextHrNumber,
  pageBounds,
  type Paged,
} from './common.js';
import { assertEmployeeVisible, employeeScopeCondition } from './data-scope.js';
import type {
  CreateEmployeeDto,
  EmployeeDetailDto,
  EmployeeDocumentDto,
  EmployeeListItemDto,
  EmploymentHistoryItemDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './hr.dto.js';

const {
  employees,
  departments,
  designations,
  workLocations,
  employmentHistory,
  employeeDocuments,
  userTenantMemberships,
} = schema;

/**
 * Employee master + lifecycle (Phase 12, ADR 0041).
 *
 * Identity ≠ Employee. An employee MAY link to a `user_tenant_memberships` row
 * (`membershipId`) but never duplicates a password, session, role or
 * permission. An employee can exist without a login; a user without an employee.
 * List DTOs never carry salary or bank details.
 *
 * Important historical changes (department / designation / manager / location /
 * type / status) write an immutable, effective-dated `hr_employment_history`
 * row inside the same transaction — never an overwrite.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ---- reads ------------------------------------------------

  list(scope: HrScope, query: ListEmployeesQueryDto): Promise<Paged<EmployeeListItemDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(employees.tenantId, scope.tenantId)];
      if (query.q) {
        const like = `%${query.q}%`;
        conds.push(
          or(
            ilike(employees.displayName, like),
            ilike(employees.employeeNumber, like),
            ilike(employees.workEmail, like),
          )!,
        );
      }
      if (query.departmentId) conds.push(eq(employees.departmentId, query.departmentId));
      if (query.designationId) conds.push(eq(employees.designationId, query.designationId));
      if (query.workLocationId) conds.push(eq(employees.workLocationId, query.workLocationId));
      if (query.status) conds.push(eq(employees.status, query.status as EmployeeStatus));
      if (query.employmentType)
        conds.push(eq(employees.employmentType, query.employmentType as 'FULL_TIME'));
      const scopeCond = await employeeScopeCondition(tx, scope);
      if (scopeCond) conds.push(scopeCond);
      const where = and(...conds)!;

      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(where);
      const rows = await tx
        .select(this.listCols())
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .leftJoin(designations, eq(designations.id, employees.designationId))
        .leftJoin(workLocations, eq(workLocations.id, employees.workLocationId))
        .where(where)
        .orderBy(employees.displayName)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      // manager names in one pass (no N+1)
      const mgrIds = [...new Set(rows.map((r) => r.managerId).filter(Boolean))] as string[];
      const mgrNames = new Map<string, string>();
      if (mgrIds.length) {
        for (const m of await tx
          .select({ id: employees.id, name: employees.displayName })
          .from(employees)
          .where(and(eq(employees.tenantId, scope.tenantId), inArray(employees.id, mgrIds)))) {
          mgrNames.set(m.id, m.name);
        }
      }

      return {
        items: rows.map((r) => this.toListItem(r, mgrNames)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  get(scope: HrScope, id: string): Promise<EmployeeDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, id);
      return this.detail(tx, scope.tenantId, id);
    });
  }

  async detail(tx: Tx, tenantId: string, id: string): Promise<EmployeeDetailDto> {
    const [row] = await tx
      .select({
        ...this.listCols(),
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        personalEmail: employees.personalEmail,
        phone: employees.phone,
        addressLine: employees.addressLine,
        city: employees.city,
        region: employees.region,
        country: employees.country,
        postalCode: employees.postalCode,
        emergencyContactName: employees.emergencyContactName,
        emergencyContactPhone: employees.emergencyContactPhone,
        emergencyContactRelation: employees.emergencyContactRelation,
        category: employees.category,
        probationEndDate: employees.probationEndDate,
        scheduleId: employees.scheduleId,
        membershipId: employees.membershipId,
        notes: employees.notes,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(workLocations, eq(workLocations.id, employees.workLocationId))
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
      .limit(1);
    if (!row) throw new AppError('HR_EMPLOYEE_NOT_FOUND');

    const mgrNames = new Map<string, string>();
    if (row.managerId) {
      const [m] = await tx
        .select({ name: employees.displayName })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, row.managerId)))
        .limit(1);
      if (m) mgrNames.set(row.managerId, m.name);
    }
    return {
      ...this.toListItem(row, mgrNames),
      firstName: row.firstName,
      middleName: row.middleName,
      lastName: row.lastName,
      personalEmail: row.personalEmail,
      phone: row.phone,
      addressLine: row.addressLine,
      city: row.city,
      region: row.region,
      country: row.country,
      postalCode: row.postalCode,
      emergencyContactName: row.emergencyContactName,
      emergencyContactPhone: row.emergencyContactPhone,
      emergencyContactRelation: row.emergencyContactRelation,
      category: row.category,
      probationEndDate: row.probationEndDate,
      departmentId: row.departmentId,
      designationId: row.designationId,
      workLocationId: row.workLocationId,
      managerId: row.managerId,
      scheduleId: row.scheduleId,
      membershipId: row.membershipId,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }

  history(scope: HrScope, id: string): Promise<EmploymentHistoryItemDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, id);
      await assertEmployeeVisible(tx, scope, id);
      const rows = await tx
        .select()
        .from(employmentHistory)
        .where(
          and(eq(employmentHistory.tenantId, scope.tenantId), eq(employmentHistory.employeeId, id)),
        )
        .orderBy(desc(employmentHistory.effectiveDate), desc(employmentHistory.createdAt));
      return rows.map((r) => ({
        id: r.id,
        effectiveDate: r.effectiveDate,
        changeType: r.changeType,
        from: r.fromValue,
        to: r.toValue,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  listDocuments(scope: HrScope, id: string): Promise<EmployeeDocumentDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, id);
      await assertEmployeeVisible(tx, scope, id);
      return this.documentRows(tx, scope.tenantId, id, false);
    });
  }

  /** The employee's own view: only documents HR has shared. `employeeId` must be
   *  the caller's own (resolved from their membership, never client-supplied). */
  listMyDocuments(scope: HrScope, employeeId: string): Promise<EmployeeDocumentDto[]> {
    return withTenantContext(getDb(), scope, (tx) =>
      this.documentRows(tx, scope.tenantId, employeeId, true),
    );
  }

  private async documentRows(
    tx: Tx,
    tenantId: string,
    employeeId: string,
    sharedOnly: boolean,
  ): Promise<EmployeeDocumentDto[]> {
    const rows = await tx
      .select()
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.tenantId, tenantId),
          eq(employeeDocuments.employeeId, employeeId),
          sharedOnly ? eq(employeeDocuments.sharedWithEmployee, true) : undefined,
        ),
      )
      .orderBy(desc(employeeDocuments.createdAt));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      originalFilename: r.originalFilename,
      sharedWithEmployee: r.sharedWithEmployee,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Existence + data-scope check to run BEFORE any storage I/O for an employee,
   *  so an out-of-scope caller can't leave orphaned objects behind. */
  ensureAccessible(scope: HrScope, id: string): Promise<void> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, id);
      await assertEmployeeVisible(tx, scope, id);
    });
  }

  // ---- writes ------------------------------------------------

  async create(scope: HrScope, body: CreateEmployeeDto): Promise<EmployeeDetailDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      await this.validateOrgRefs(tx, scope.tenantId, body);
      if (body.managerId) await this.requireEmployee(tx, scope.tenantId, body.managerId);
      const number = await nextHrNumber(tx, scope.tenantId, 'employee');
      const displayName =
        body.displayName?.trim() || `${body.firstName.trim()} ${body.lastName.trim()}`;
      try {
        const [row] = await tx
          .insert(employees)
          .values({
            tenantId: scope.tenantId,
            employeeNumber: number,
            firstName: body.firstName.trim(),
            middleName: body.middleName?.trim() || null,
            lastName: body.lastName.trim(),
            displayName,
            workEmail: body.workEmail?.trim() || null,
            personalEmail: body.personalEmail?.trim() || null,
            phone: body.phone?.trim() || null,
            addressLine: body.addressLine ?? null,
            city: body.city ?? null,
            region: body.region ?? null,
            country: body.country ?? null,
            postalCode: body.postalCode ?? null,
            emergencyContactName: body.emergencyContactName ?? null,
            emergencyContactPhone: body.emergencyContactPhone ?? null,
            emergencyContactRelation: body.emergencyContactRelation ?? null,
            joiningDate: body.joiningDate.slice(0, 10),
            status: (body.status as 'ONBOARDING' | 'ACTIVE' | undefined) ?? 'ACTIVE',
            employmentType: (body.employmentType as 'FULL_TIME') ?? 'FULL_TIME',
            departmentId: body.departmentId ?? null,
            designationId: body.designationId ?? null,
            workLocationId: body.workLocationId ?? null,
            managerId: body.managerId ?? null,
            scheduleId: body.scheduleId ?? null,
            category: body.category ?? null,
            probationEndDate: body.probationEndDate?.slice(0, 10) ?? null,
            notes: body.notes ?? null,
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: employees.id });
        const newId = row!.id;

        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'hr.employee.created',
          entityType: 'employee',
          entityId: newId,
          actor: userActor(scope),
          metadata: {
            employeeNumber: number,
            employmentType: body.employmentType ?? 'FULL_TIME',
            status: body.status ?? 'ACTIVE',
          },
        });
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'hr.employee.created',
          payload: { employeeId: newId, employeeNumber: number },
          actorMembershipId: scope.actorMembershipId,
        });
        return newId;
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('HR_DUPLICATE_CODE');
        if (isFkViolation(err)) throw new AppError('HR_ORG_UNIT_NOT_FOUND');
        throw err;
      }
    });
    // Unscoped read-back: a creator with a narrowed data scope may create a
    // record outside their own scope, and the create must still return it.
    return withTenantContext(getDb(), scope, (tx) => this.detail(tx, scope.tenantId, id));
  }

  async update(scope: HrScope, id: string, body: UpdateEmployeeDto): Promise<EmployeeDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, id);
      const before = await this.lock(tx, scope.tenantId, id);
      await this.validateOrgRefs(tx, scope.tenantId, body, before);

      if (body.managerId !== undefined && body.managerId !== null) {
        if (body.managerId === id) throw new AppError('HR_INVALID_MANAGER');
        await this.requireEmployee(tx, scope.tenantId, body.managerId);
        if (await this.wouldCycle(tx, scope.tenantId, id, body.managerId)) {
          throw new AppError('HR_INVALID_MANAGER', {
            details: { hint: 'creates a reporting cycle' },
          });
        }
      }

      const set: Record<string, unknown> = { updatedAt: new Date() };
      const scalar = [
        'firstName',
        'middleName',
        'lastName',
        'workEmail',
        'personalEmail',
        'phone',
        'addressLine',
        'city',
        'region',
        'country',
        'postalCode',
        'emergencyContactName',
        'emergencyContactPhone',
        'emergencyContactRelation',
        'category',
        'notes',
      ] as const;
      for (const k of scalar)
        if (body[k] !== undefined) set[k] = (body[k] as string)?.trim() || null;
      if (
        body.firstName !== undefined ||
        body.lastName !== undefined ||
        body.displayName !== undefined
      ) {
        set.displayName =
          body.displayName?.trim() ||
          `${(body.firstName ?? before.firstName).trim()} ${(body.lastName ?? before.lastName).trim()}`;
      }
      if (body.joiningDate !== undefined) set.joiningDate = body.joiningDate.slice(0, 10);
      if (body.probationEndDate !== undefined)
        set.probationEndDate = body.probationEndDate?.slice(0, 10) ?? null;
      if (body.employmentType !== undefined) set.employmentType = body.employmentType;
      if (body.departmentId !== undefined) set.departmentId = body.departmentId ?? null;
      if (body.designationId !== undefined) set.designationId = body.designationId ?? null;
      if (body.workLocationId !== undefined) set.workLocationId = body.workLocationId ?? null;
      if (body.managerId !== undefined) set.managerId = body.managerId ?? null;
      if (body.scheduleId !== undefined) set.scheduleId = body.scheduleId ?? null;

      try {
        await tx
          .update(employees)
          .set(set)
          .where(and(eq(employees.id, id), eq(employees.tenantId, scope.tenantId)));
      } catch (err) {
        if (isFkViolation(err)) throw new AppError('HR_ORG_UNIT_NOT_FOUND');
        throw err;
      }

      // record the changes that matter for HR history
      const effective = (body.joiningDate ?? new Date().toISOString()).slice(0, 10);
      const changes: {
        type: 'DEPARTMENT' | 'DESIGNATION' | 'MANAGER' | 'LOCATION' | 'EMPLOYMENT_TYPE';
        from: string | null;
        to: string | null;
        action?:
          | 'hr.employee.department_changed'
          | 'hr.employee.designation_changed'
          | 'hr.employee.manager_changed';
      }[] = [];
      if (body.departmentId !== undefined && body.departmentId !== before.departmentId)
        changes.push({
          type: 'DEPARTMENT',
          from: before.departmentId,
          to: body.departmentId ?? null,
          action: 'hr.employee.department_changed',
        });
      if (body.designationId !== undefined && body.designationId !== before.designationId)
        changes.push({
          type: 'DESIGNATION',
          from: before.designationId,
          to: body.designationId ?? null,
          action: 'hr.employee.designation_changed',
        });
      if (body.managerId !== undefined && body.managerId !== before.managerId)
        changes.push({
          type: 'MANAGER',
          from: before.managerId,
          to: body.managerId ?? null,
          action: 'hr.employee.manager_changed',
        });
      if (body.workLocationId !== undefined && body.workLocationId !== before.workLocationId)
        changes.push({
          type: 'LOCATION',
          from: before.workLocationId,
          to: body.workLocationId ?? null,
        });
      if (body.employmentType !== undefined && body.employmentType !== before.employmentType)
        changes.push({
          type: 'EMPLOYMENT_TYPE',
          from: before.employmentType,
          to: body.employmentType,
        });

      for (const c of changes) {
        await tx.insert(employmentHistory).values({
          tenantId: scope.tenantId,
          employeeId: id,
          changeType: c.type,
          effectiveDate: effective,
          fromValue: { value: c.from },
          toValue: { value: c.to },
          reason: body.changeReason ?? null,
          changedByMembershipId: scope.actorMembershipId,
        });
        if (c.action) {
          await this.audit.record(tx, {
            tenantId: scope.tenantId,
            action: c.action,
            entityType: 'employee',
            entityId: id,
            actor: userActor(scope),
            changes: { [c.type.toLowerCase()]: { from: c.from, to: c.to } },
          });
        }
      }
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.employee.updated',
        entityType: 'employee',
        entityId: id,
        actor: userActor(scope),
        metadata: { fields: Object.keys(set).filter((k) => k !== 'updatedAt') },
      });
    });
    return this.get(scope, id);
  }

  async changeStatus(
    scope: HrScope,
    id: string,
    to: EmployeeStatus,
    reason: string | undefined,
  ): Promise<EmployeeDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, id);
      const before = await this.lock(tx, scope.tenantId, id);
      if (before.status === to) return;
      if (!canTransitionEmployee(before.status as EmployeeStatus, to)) {
        throw new AppError('HR_INVALID_STATE', { details: { from: before.status, to } });
      }
      const set: Record<string, unknown> = { status: to, updatedAt: new Date() };
      if (isTerminalEmployeeStatus(to)) {
        set.terminatedAt = new Date();
        set.terminationReason = reason ?? null;
      }
      await tx
        .update(employees)
        .set(set)
        .where(and(eq(employees.id, id), eq(employees.tenantId, scope.tenantId)));
      await tx.insert(employmentHistory).values({
        tenantId: scope.tenantId,
        employeeId: id,
        changeType: 'STATUS',
        effectiveDate: new Date().toISOString().slice(0, 10),
        fromValue: { value: before.status },
        toValue: { value: to },
        reason: reason ?? null,
        changedByMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.employee.status_changed',
        entityType: 'employee',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: before.status, to } },
        metadata: reason ? { reason } : undefined,
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.employee.status_changed',
        payload: { employeeId: id, from: before.status, to },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.get(scope, id);
  }

  async linkMembership(
    scope: HrScope,
    id: string,
    membershipId: string,
  ): Promise<EmployeeDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, id);
      await this.lock(tx, scope.tenantId, id);
      const [m] = await tx
        .select({ id: userTenantMemberships.id })
        .from(userTenantMemberships)
        .where(
          and(
            eq(userTenantMemberships.id, membershipId),
            eq(userTenantMemberships.tenantId, scope.tenantId),
          ),
        )
        .limit(1);
      if (!m) throw new AppError('HR_MEMBERSHIP_INVALID');
      const [dupe] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, scope.tenantId),
            eq(employees.membershipId, membershipId),
            sql`${employees.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (dupe)
        throw new AppError('HR_MEMBERSHIP_INVALID', {
          details: { hint: 'already linked to another employee' },
        });

      await tx
        .update(employees)
        .set({ membershipId, updatedAt: new Date() })
        .where(and(eq(employees.id, id), eq(employees.tenantId, scope.tenantId)));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.employee.membership_linked',
        entityType: 'employee',
        entityId: id,
        actor: userActor(scope),
        metadata: { membershipId },
      });
    });
    return this.get(scope, id);
  }

  async unlinkMembership(scope: HrScope, id: string): Promise<EmployeeDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, id);
      await this.lock(tx, scope.tenantId, id);
      await tx
        .update(employees)
        .set({ membershipId: null, updatedAt: new Date() })
        .where(and(eq(employees.id, id), eq(employees.tenantId, scope.tenantId)));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.employee.membership_unlinked',
        entityType: 'employee',
        entityId: id,
        actor: userActor(scope),
      });
    });
    return this.get(scope, id);
  }

  async attachDocument(
    scope: HrScope,
    id: string,
    doc: {
      kind: string;
      title: string;
      objectKey: string;
      contentType: string;
      sizeBytes: number;
      originalFilename: string | null;
      sharedWithEmployee: boolean;
    },
  ): Promise<EmployeeDocumentDto[]> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, id);
      await assertEmployeeVisible(tx, scope, id);
      await tx.insert(employeeDocuments).values({
        tenantId: scope.tenantId,
        employeeId: id,
        kind: doc.kind,
        title: doc.title,
        objectKey: doc.objectKey,
        contentType: doc.contentType,
        sizeBytes: doc.sizeBytes,
        originalFilename: doc.originalFilename,
        sharedWithEmployee: doc.sharedWithEmployee,
        uploadedByMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.employee.document_added',
        entityType: 'employee',
        entityId: id,
        actor: userActor(scope),
        metadata: {
          kind: doc.kind,
          title: doc.title,
          contentType: doc.contentType,
          sharedWithEmployee: doc.sharedWithEmployee,
        },
      });
    });
    return this.listDocuments(scope, id);
  }

  /** HR controls whether the employee can see a document (`hr.employee.manage`). */
  async setDocumentSharing(
    scope: HrScope,
    employeeId: string,
    documentId: string,
    sharedWithEmployee: boolean,
  ): Promise<EmployeeDocumentDto[]> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, employeeId);
      const res = await tx
        .update(employeeDocuments)
        .set({ sharedWithEmployee })
        .where(
          and(
            eq(employeeDocuments.tenantId, scope.tenantId),
            eq(employeeDocuments.employeeId, employeeId),
            eq(employeeDocuments.id, documentId),
          ),
        )
        .returning({ id: employeeDocuments.id });
      if (res.length === 0) throw new AppError('HR_ATTACHMENT_INVALID');
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.employee.document_sharing_changed',
        entityType: 'employee',
        entityId: employeeId,
        actor: userActor(scope),
        metadata: { documentId, sharedWithEmployee },
      });
    });
    return this.listDocuments(scope, employeeId);
  }

  /** Object key for a document the employee may download themselves — only ever
   *  their own, and only if shared. Indistinguishable 'not found' otherwise. */
  async myDocumentObjectKey(
    scope: HrScope,
    employeeId: string,
    documentId: string,
  ): Promise<string> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({ objectKey: employeeDocuments.objectKey })
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.tenantId, scope.tenantId),
            eq(employeeDocuments.employeeId, employeeId),
            eq(employeeDocuments.id, documentId),
            eq(employeeDocuments.sharedWithEmployee, true),
          ),
        )
        .limit(1);
      if (!row) throw new AppError('HR_ATTACHMENT_INVALID');
      return row.objectKey;
    });
  }

  /** Object key for a stored document, tenant-scoped. */
  async documentObjectKey(scope: HrScope, employeeId: string, documentId: string): Promise<string> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, employeeId);
      const [row] = await tx
        .select({ objectKey: employeeDocuments.objectKey })
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.tenantId, scope.tenantId),
            eq(employeeDocuments.employeeId, employeeId),
            eq(employeeDocuments.id, documentId),
          ),
        )
        .limit(1);
      if (!row) throw new AppError('HR_ATTACHMENT_INVALID');
      return row.objectKey;
    });
  }

  /** Delete an employee document row and return its object key for storage cleanup. */
  async deleteDocument(scope: HrScope, employeeId: string, documentId: string): Promise<string> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await assertEmployeeVisible(tx, scope, employeeId);
      const [row] = await tx
        .select({ objectKey: employeeDocuments.objectKey })
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.tenantId, scope.tenantId),
            eq(employeeDocuments.employeeId, employeeId),
            eq(employeeDocuments.id, documentId),
          ),
        )
        .limit(1);
      if (!row) throw new AppError('HR_ATTACHMENT_INVALID');
      await tx
        .delete(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.tenantId, scope.tenantId),
            eq(employeeDocuments.employeeId, employeeId),
            eq(employeeDocuments.id, documentId),
          ),
        );
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.employee.document_deleted',
        entityType: 'employee',
        entityId: employeeId,
        actor: userActor(scope),
        metadata: { documentId },
      });
      return row.objectKey;
    });
  }

  // ---- helpers --------------------------------------------

  private listCols() {
    return {
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      displayName: employees.displayName,
      workEmail: employees.workEmail,
      status: employees.status,
      employmentType: employees.employmentType,
      joiningDate: employees.joiningDate,
      managerId: employees.managerId,
      membershipId: employees.membershipId,
      departmentId: employees.departmentId,
      designationId: employees.designationId,
      workLocationId: employees.workLocationId,
      department: departments.name,
      designation: designations.name,
      workLocation: workLocations.name,
    };
  }

  private toListItem(
    r: {
      id: string;
      employeeNumber: string;
      displayName: string;
      workEmail: string | null;
      status: string;
      employmentType: string;
      joiningDate: string;
      managerId: string | null;
      membershipId: string | null;
      department: string | null;
      designation: string | null;
      workLocation: string | null;
    },
    mgrNames: Map<string, string>,
  ): EmployeeListItemDto {
    return {
      id: r.id,
      employeeNumber: r.employeeNumber,
      displayName: r.displayName,
      workEmail: r.workEmail,
      status: r.status,
      employmentType: r.employmentType,
      department: r.department,
      designation: r.designation,
      workLocation: r.workLocation,
      managerName: r.managerId ? (mgrNames.get(r.managerId) ?? null) : null,
      hasLogin: !!r.membershipId,
      joiningDate: r.joiningDate,
    };
  }

  private async lock(tx: Tx, tenantId: string, id: string) {
    const [row] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
      .for('update')
      .limit(1);
    if (!row) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
    return row;
  }

  private async requireEmployee(tx: Tx, tenantId: string, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
      .limit(1);
    if (!row) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
  }

  /** Every referenced unit must exist in this tenant, and must not be archived —
   *  except a unit the employee already holds (`current`), which they keep. */
  private async validateOrgRefs(
    tx: Tx,
    tenantId: string,
    body: Partial<CreateEmployeeDto>,
    current?: {
      departmentId: string | null;
      designationId: string | null;
      workLocationId: string | null;
    },
  ): Promise<void> {
    const checks: [
      string | undefined,
      typeof departments | typeof designations | typeof workLocations,
      string | null | undefined,
    ][] = [
      [body.departmentId, departments, current?.departmentId],
      [body.designationId, designations, current?.designationId],
      [body.workLocationId, workLocations, current?.workLocationId],
    ];
    for (const [id, table, held] of checks) {
      if (!id) continue;
      const [row] = await tx
        .select({ id: table.id, status: table.status })
        .from(table)
        .where(and(eq(table.id, id), eq(table.tenantId, tenantId)))
        .limit(1);
      if (!row) throw new AppError('HR_ORG_UNIT_NOT_FOUND');
      if (row.status === 'ARCHIVED' && id !== held) throw new AppError('HR_ORG_UNIT_ARCHIVED');
    }
  }

  /** True if making `candidateManagerId` the manager of `employeeId` would form a cycle. */
  private async wouldCycle(
    tx: Tx,
    tenantId: string,
    employeeId: string,
    candidateManagerId: string,
  ): Promise<boolean> {
    let cursor: string | null = candidateManagerId;
    for (let i = 0; i < 100 && cursor; i += 1) {
      if (cursor === employeeId) return true;
      const [row]: { managerId: string | null }[] = await tx
        .select({ managerId: employees.managerId })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, cursor)))
        .limit(1);
      cursor = row?.managerId ?? null;
    }
    return false;
  }
}
