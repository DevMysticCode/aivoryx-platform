import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { HrScope, isUniqueViolation } from './common.js';
import type {
  CreateOrgUnitDto,
  CreateWorkLocationDto,
  CreateWorkScheduleDto,
  OrgChartDto,
  OrgUnitDto,
  UpdateOrgUnitDto,
  WorkLocationDto,
  WorkScheduleDto,
} from './hr.dto.js';

const { departments, designations, workLocations, workSchedules, employees } = schema;

/**
 * Organisation structure (Phase 12, ADR 0041). Everything is tenant-configurable
 * — nothing (Sales, Finance, Installation …) is hardcoded. Departments,
 * designations, locations and schedules are simple tenant-scoped reference data;
 * the org chart is derived live from employee reporting relationships.
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly audit: AuditService) {}

  // ---- departments -------------------------------------------

  listDepartments(scope: HrScope): Promise<OrgUnitDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(departments)
        .where(eq(departments.tenantId, scope.tenantId))
        .orderBy(departments.name);
      const counts = await this.employeeCounts(tx, scope.tenantId, 'departmentId');
      return rows.map((r) => this.toUnit(r, counts.get(r.id) ?? 0));
    });
  }

  createDepartment(scope: HrScope, body: CreateOrgUnitDto): Promise<OrgUnitDto> {
    return this.createUnit(
      scope,
      departments,
      body,
      'hr.organization.department_created',
      'department',
    );
  }

  updateDepartment(scope: HrScope, id: string, body: UpdateOrgUnitDto): Promise<OrgUnitDto> {
    return this.updateUnit(scope, departments, id, body);
  }

  // ---- designations -----------------------------------------

  listDesignations(scope: HrScope): Promise<OrgUnitDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(designations)
        .where(eq(designations.tenantId, scope.tenantId))
        .orderBy(designations.name);
      const counts = await this.employeeCounts(tx, scope.tenantId, 'designationId');
      return rows.map((r) => this.toUnit(r, counts.get(r.id) ?? 0));
    });
  }

  createDesignation(scope: HrScope, body: CreateOrgUnitDto): Promise<OrgUnitDto> {
    return this.createUnit(
      scope,
      designations,
      body,
      'hr.organization.designation_created',
      'designation',
    );
  }

  updateDesignation(scope: HrScope, id: string, body: UpdateOrgUnitDto): Promise<OrgUnitDto> {
    return this.updateUnit(scope, designations, id, body);
  }

  // ---- work locations -------------------------------------

  listLocations(scope: HrScope): Promise<WorkLocationDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(workLocations)
        .where(eq(workLocations.tenantId, scope.tenantId))
        .orderBy(workLocations.name);
      const counts = await this.employeeCounts(tx, scope.tenantId, 'workLocationId');
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        status: r.status,
        employeeCount: counts.get(r.id) ?? 0,
        addressLine: r.addressLine,
        city: r.city,
        region: r.region,
        country: r.country,
        postalCode: r.postalCode,
        latitude: r.latitude,
        longitude: r.longitude,
      }));
    });
  }

  async createLocation(scope: HrScope, body: CreateWorkLocationDto): Promise<WorkLocationDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      try {
        const [row] = await tx
          .insert(workLocations)
          .values({
            tenantId: scope.tenantId,
            name: body.name.trim(),
            code: body.code.trim(),
            addressLine: body.addressLine ?? null,
            city: body.city ?? null,
            region: body.region ?? null,
            country: body.country ?? null,
            postalCode: body.postalCode ?? null,
            latitude: body.latitude ?? null,
            longitude: body.longitude ?? null,
          })
          .returning({ id: workLocations.id });
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'hr.organization.location_created',
          entityType: 'work_location',
          entityId: row!.id,
          actor: userActor(scope),
          metadata: { code: body.code, name: body.name },
        });
        return row!.id;
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('HR_DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
    });
    return (await this.listLocations(scope)).find((l) => l.id === id)!;
  }

  updateLocation(scope: HrScope, id: string, body: UpdateOrgUnitDto): Promise<WorkLocationDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) set.name = body.name.trim();
      if (body.status !== undefined) set.status = body.status;
      const res = await tx
        .update(workLocations)
        .set(set)
        .where(and(eq(workLocations.id, id), eq(workLocations.tenantId, scope.tenantId)))
        .returning({ id: workLocations.id });
      if (res.length === 0) throw new AppError('HR_ORG_UNIT_NOT_FOUND');
      return (await this.listLocations(scope)).find((l) => l.id === id)!;
    });
  }

  // ---- schedules ----------------------------------------

  listSchedules(scope: HrScope): Promise<WorkScheduleDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(workSchedules)
        .where(eq(workSchedules.tenantId, scope.tenantId))
        .orderBy(workSchedules.name);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        startTime: r.startTime,
        endTime: r.endTime,
        workingDaysMask: r.workingDaysMask,
        graceMinutes: r.graceMinutes,
        locationId: r.locationId,
        status: r.status,
      }));
    });
  }

  async createSchedule(scope: HrScope, body: CreateWorkScheduleDto): Promise<WorkScheduleDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      if (body.locationId) {
        const [loc] = await tx
          .select({ id: workLocations.id })
          .from(workLocations)
          .where(
            and(eq(workLocations.id, body.locationId), eq(workLocations.tenantId, scope.tenantId)),
          )
          .limit(1);
        if (!loc) throw new AppError('HR_ORG_UNIT_NOT_FOUND');
      }
      const [row] = await tx
        .insert(workSchedules)
        .values({
          tenantId: scope.tenantId,
          name: body.name.trim(),
          startTime: body.startTime,
          endTime: body.endTime,
          workingDaysMask: body.workingDaysMask ?? 31,
          graceMinutes: body.graceMinutes ?? 0,
          locationId: body.locationId ?? null,
        })
        .returning({ id: workSchedules.id });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.organization.schedule_created',
        entityType: 'work_schedule',
        entityId: row!.id,
        actor: userActor(scope),
        metadata: { name: body.name, startTime: body.startTime, endTime: body.endTime },
      });
      return row!.id;
    });
    return (await this.listSchedules(scope)).find((s) => s.id === id)!;
  }

  // ---- org chart --------------------------------------

  orgChart(scope: HrScope): Promise<OrgChartDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: employees.id,
          employeeNumber: employees.employeeNumber,
          displayName: employees.displayName,
          managerId: employees.managerId,
          designation: designations.name,
          department: departments.name,
        })
        .from(employees)
        .leftJoin(designations, eq(designations.id, employees.designationId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(
          and(
            eq(employees.tenantId, scope.tenantId),
            inArray(employees.status, ['ACTIVE', 'ON_LEAVE', 'SUSPENDED']),
          ),
        )
        .orderBy(employees.displayName);
      const reports = new Map<string, number>();
      for (const r of rows)
        if (r.managerId) reports.set(r.managerId, (reports.get(r.managerId) ?? 0) + 1);
      return {
        nodes: rows.map((r) => ({
          employeeId: r.id,
          employeeNumber: r.employeeNumber,
          displayName: r.displayName,
          designation: r.designation,
          department: r.department,
          managerId: r.managerId,
          directReports: reports.get(r.id) ?? 0,
        })),
      };
    });
  }

  // ---- helpers ----------------------------------------

  private toUnit(
    r: { id: string; name: string; code: string; status: string },
    employeeCount: number,
  ): OrgUnitDto {
    return { id: r.id, name: r.name, code: r.code, status: r.status, employeeCount };
  }

  private async employeeCounts(
    tx: Tx,
    tenantId: string,
    col: 'departmentId' | 'designationId' | 'workLocationId',
  ): Promise<Map<string, number>> {
    const rows = await tx
      .select({ key: employees[col], n: sql<number>`count(*)::int` })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          inArray(employees.status, ['ACTIVE', 'ON_LEAVE', 'SUSPENDED']),
        ),
      )
      .groupBy(employees[col]);
    return new Map(rows.filter((r) => r.key).map((r) => [r.key as string, r.n]));
  }

  private async createUnit(
    scope: HrScope,
    table: typeof departments | typeof designations,
    body: CreateOrgUnitDto,
    action: 'hr.organization.department_created' | 'hr.organization.designation_created',
    entityType: string,
  ): Promise<OrgUnitDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      try {
        const [row] = await tx
          .insert(table)
          .values({ tenantId: scope.tenantId, name: body.name.trim(), code: body.code.trim() })
          .returning({ id: table.id });
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action,
          entityType,
          entityId: row!.id,
          actor: userActor(scope),
          metadata: { code: body.code, name: body.name },
        });
        return row!.id;
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('HR_DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
    });
    const list =
      table === departments
        ? await this.listDepartments(scope)
        : await this.listDesignations(scope);
    return list.find((u) => u.id === id)!;
  }

  private async updateUnit(
    scope: HrScope,
    table: typeof departments | typeof designations,
    id: string,
    body: UpdateOrgUnitDto,
  ): Promise<OrgUnitDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) set.name = body.name.trim();
      if (body.status !== undefined) set.status = body.status;
      const res = await tx
        .update(table)
        .set(set)
        .where(and(eq(table.id, id), eq(table.tenantId, scope.tenantId)))
        .returning({ id: table.id });
      if (res.length === 0) throw new AppError('HR_ORG_UNIT_NOT_FOUND');
    });
    const list =
      table === departments
        ? await this.listDepartments(scope)
        : await this.listDesignations(scope);
    return list.find((u) => u.id === id)!;
  }
}
