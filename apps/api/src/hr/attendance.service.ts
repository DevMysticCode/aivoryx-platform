import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import {
  gpsDistanceMeters,
  HrScope,
  isUniqueViolation,
  pageBounds,
  resolveMyEmployeeId,
  type Paged,
} from './common.js';
import type {
  AttendanceRecordDto,
  CheckInDto,
  CorrectAttendanceDto,
  GeoPointDto,
  ListAttendanceQueryDto,
  RecordAttendanceDto,
} from './hr.dto.js';

const { attendanceRecords, attendanceCorrections, employees, workSchedules, workLocations } =
  schema;

/**
 * Operational attendance (Phase 12, ADR 0041).
 *
 * One record per employee per work date (the unique key makes overlapping
 * sessions impossible). Check-in creates it, check-out updates it. Server
 * timestamps only — client timestamps are never trusted. GPS is optional and
 * policy-dependent: a straight-line distance from the work location is recorded
 * for information, never as proof of physical presence. Corrections are
 * immutable records of original + new value and always audited; ordinary
 * employees cannot edit history.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly audit: AuditService) {}

  // ---- self-service --------------------------------------

  checkIn(
    scope: HrScope,
    body: CheckInDto,
    source: 'WEB' | 'MOBILE',
  ): Promise<AttendanceRecordDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const employeeId = await resolveMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      return this.doCheckIn(tx, scope, employeeId, body.point, body.notes, source);
    });
  }

  checkOut(
    scope: HrScope,
    body: CheckInDto,
    source: 'WEB' | 'MOBILE',
  ): Promise<AttendanceRecordDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const employeeId = await resolveMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      return this.doCheckOut(tx, scope, employeeId, body.point, source);
    });
  }

  /** Admin check-in/out for a specific employee (`hr.attendance.manage`). */
  checkInFor(scope: HrScope, employeeId: string, body: CheckInDto): Promise<AttendanceRecordDto> {
    return withTenantContext(getDb(), scope, (tx) =>
      this.doCheckIn(tx, scope, employeeId, body.point, body.notes, 'ADMIN'),
    );
  }

  checkOutFor(scope: HrScope, employeeId: string, body: CheckInDto): Promise<AttendanceRecordDto> {
    return withTenantContext(getDb(), scope, (tx) =>
      this.doCheckOut(tx, scope, employeeId, body.point, 'ADMIN'),
    );
  }

  // ---- admin record ------------------------------------

  record(scope: HrScope, body: RecordAttendanceDto): Promise<AttendanceRecordDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, body.employeeId);
      const workDate = body.workDate.slice(0, 10);
      const values = {
        tenantId: scope.tenantId,
        employeeId: body.employeeId,
        workDate,
        status: body.status as 'PRESENT',
        checkInAt: body.checkInAt ? new Date(body.checkInAt) : null,
        checkOutAt: body.checkOutAt ? new Date(body.checkOutAt) : null,
        source: 'ADMIN' as const,
        notes: body.notes ?? null,
        createdByMembershipId: scope.actorMembershipId,
      };
      const [row] = await tx
        .insert(attendanceRecords)
        .values(values)
        .onConflictDoUpdate({
          target: [
            attendanceRecords.tenantId,
            attendanceRecords.employeeId,
            attendanceRecords.workDate,
          ],
          set: {
            status: values.status,
            checkInAt: values.checkInAt,
            checkOutAt: values.checkOutAt,
            source: 'ADMIN',
            notes: values.notes,
            updatedAt: new Date(),
          },
        })
        .returning();
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.attendance.recorded',
        entityType: 'attendance_record',
        entityId: row!.id,
        actor: userActor(scope),
        metadata: { employeeId: body.employeeId, workDate, status: body.status, source: 'ADMIN' },
      });
      return this.toDto(tx, scope.tenantId, row!.id);
    });
  }

  async correct(
    scope: HrScope,
    attendanceRecordId: string,
    body: CorrectAttendanceDto,
  ): Promise<AttendanceRecordDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [rec] = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.tenantId, scope.tenantId),
            eq(attendanceRecords.id, attendanceRecordId),
          ),
        )
        .for('update')
        .limit(1);
      if (!rec) throw new AppError('HR_ATTENDANCE_NOT_FOUND');

      const isTime = body.field === 'checkInAt' || body.field === 'checkOutAt';
      const original =
        body.field === 'status'
          ? rec.status
          : body.field === 'notes'
            ? rec.notes
            : body.field === 'checkInAt'
              ? (rec.checkInAt?.toISOString() ?? null)
              : (rec.checkOutAt?.toISOString() ?? null);
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (body.field === 'status') set.status = body.value;
      else if (body.field === 'notes') set.notes = body.value || null;
      else set[body.field] = isTime && body.value ? new Date(body.value) : null;

      await tx
        .update(attendanceRecords)
        .set(set)
        .where(eq(attendanceRecords.id, attendanceRecordId));
      await tx.insert(attendanceCorrections).values({
        tenantId: scope.tenantId,
        attendanceRecordId,
        field: body.field,
        originalValue: original,
        correctedValue: body.value,
        reason: body.reason,
        correctedByMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.attendance.corrected',
        entityType: 'attendance_record',
        entityId: attendanceRecordId,
        actor: userActor(scope),
        changes: { [body.field]: { from: original, to: body.value } },
        metadata: { reason: body.reason },
      });
      return this.toDto(tx, scope.tenantId, attendanceRecordId);
    });
  }

  // ---- reads -------------------------------------------

  list(scope: HrScope, query: ListAttendanceQueryDto): Promise<Paged<AttendanceRecordDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(attendanceRecords.tenantId, scope.tenantId)];
      if (query.employeeId) conds.push(eq(attendanceRecords.employeeId, query.employeeId));
      if (query.from) conds.push(gte(attendanceRecords.workDate, query.from.slice(0, 10)));
      if (query.to) conds.push(lte(attendanceRecords.workDate, query.to.slice(0, 10)));
      if (query.status) conds.push(eq(attendanceRecords.status, query.status as 'PRESENT'));
      const where = and(...conds)!;
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(attendanceRecords)
        .where(where);
      const rows = await tx
        .select(this.cols())
        .from(attendanceRecords)
        .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
        .where(where)
        .orderBy(desc(attendanceRecords.workDate), employees.displayName)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const ids = rows.map((r) => r.id);
      const corrections = await this.correctionCounts(tx, scope.tenantId, ids);
      return {
        items: rows.map((r) => this.rowToDto(r, corrections.get(r.id) ?? 0)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  // ---- internals -------------------------------------

  private async doCheckIn(
    tx: Tx,
    scope: HrScope,
    employeeId: string,
    point: GeoPointDto | undefined,
    notes: string | undefined,
    source: 'WEB' | 'MOBILE' | 'ADMIN',
  ): Promise<AttendanceRecordDto> {
    const today = new Date().toISOString().slice(0, 10);
    const [existing] = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.tenantId, scope.tenantId),
          eq(attendanceRecords.employeeId, employeeId),
          eq(attendanceRecords.workDate, today),
        ),
      )
      .for('update')
      .limit(1);
    if (existing?.checkInAt) throw new AppError('HR_ATTENDANCE_ALREADY_CHECKED_IN');

    const gps = await this.gpsFromSchedule(tx, scope.tenantId, employeeId, point);
    if (existing) {
      const [row] = await tx
        .update(attendanceRecords)
        .set({
          checkInAt: sql`now()`,
          status: 'PRESENT',
          checkInLat: point ? String(point.lat) : null,
          checkInLng: point ? String(point.lng) : null,
          checkInAccuracyM: point?.accuracyM !== undefined ? String(point.accuracyM) : null,
          gpsDistanceM: gps !== null ? String(gps) : null,
          source,
          notes: notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecords.id, existing.id))
        .returning({ id: attendanceRecords.id });
      await this.auditCheck(tx, scope, employeeId, row!.id, 'hr.attendance.checked_in', source);
      return this.toDto(tx, scope.tenantId, row!.id);
    }
    try {
      const [row] = await tx
        .insert(attendanceRecords)
        .values({
          tenantId: scope.tenantId,
          employeeId,
          workDate: today,
          status: 'PRESENT',
          checkInAt: sql`now()`,
          checkInLat: point ? String(point.lat) : null,
          checkInLng: point ? String(point.lng) : null,
          checkInAccuracyM: point?.accuracyM !== undefined ? String(point.accuracyM) : null,
          gpsDistanceM: gps !== null ? String(gps) : null,
          source,
          notes: notes ?? null,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: attendanceRecords.id });
      await this.auditCheck(tx, scope, employeeId, row!.id, 'hr.attendance.checked_in', source);
      return this.toDto(tx, scope.tenantId, row!.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('HR_ATTENDANCE_ALREADY_CHECKED_IN');
      throw err;
    }
  }

  private async doCheckOut(
    tx: Tx,
    scope: HrScope,
    employeeId: string,
    point: GeoPointDto | undefined,
    source: 'WEB' | 'MOBILE' | 'ADMIN',
  ): Promise<AttendanceRecordDto> {
    const today = new Date().toISOString().slice(0, 10);
    const [rec] = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.tenantId, scope.tenantId),
          eq(attendanceRecords.employeeId, employeeId),
          eq(attendanceRecords.workDate, today),
        ),
      )
      .for('update')
      .limit(1);
    if (!rec || !rec.checkInAt) throw new AppError('HR_ATTENDANCE_NOT_CHECKED_IN');
    if (rec.checkOutAt) return this.toDto(tx, scope.tenantId, rec.id); // idempotent

    await tx
      .update(attendanceRecords)
      .set({
        checkOutAt: sql`now()`,
        checkOutLat: point ? String(point.lat) : null,
        checkOutLng: point ? String(point.lng) : null,
        checkOutAccuracyM: point?.accuracyM !== undefined ? String(point.accuracyM) : null,
        source,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecords.id, rec.id));
    await this.auditCheck(tx, scope, employeeId, rec.id, 'hr.attendance.checked_out', source);
    return this.toDto(tx, scope.tenantId, rec.id);
  }

  private async gpsFromSchedule(
    tx: Tx,
    tenantId: string,
    employeeId: string,
    point: GeoPointDto | undefined,
  ): Promise<number | null> {
    if (!point) return null;
    const [row] = await tx
      .select({ lat: workLocations.latitude, lng: workLocations.longitude })
      .from(employees)
      .leftJoin(
        workSchedules,
        and(eq(workSchedules.id, employees.scheduleId), eq(workSchedules.tenantId, tenantId)),
      )
      .leftJoin(
        workLocations,
        and(
          eq(workLocations.tenantId, tenantId),
          sql`${workLocations.id} = coalesce(${workSchedules.locationId}, ${employees.workLocationId})`,
        ),
      )
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId)))
      .limit(1);
    if (!row?.lat || !row?.lng) return null;
    return gpsDistanceMeters(
      { lat: Number(row.lat), lng: Number(row.lng) },
      { lat: point.lat, lng: point.lng },
    );
  }

  private async auditCheck(
    tx: Tx,
    scope: HrScope,
    employeeId: string,
    recordId: string,
    action: 'hr.attendance.checked_in' | 'hr.attendance.checked_out',
    source: string,
  ): Promise<void> {
    await this.audit.record(tx, {
      tenantId: scope.tenantId,
      action,
      entityType: 'attendance_record',
      entityId: recordId,
      actor: userActor(scope),
      metadata: { employeeId, source },
    });
  }

  private cols() {
    return {
      id: attendanceRecords.id,
      employeeId: attendanceRecords.employeeId,
      employeeName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      workDate: attendanceRecords.workDate,
      status: attendanceRecords.status,
      checkInAt: attendanceRecords.checkInAt,
      checkOutAt: attendanceRecords.checkOutAt,
      gpsDistanceM: attendanceRecords.gpsDistanceM,
      source: attendanceRecords.source,
      notes: attendanceRecords.notes,
    };
  }

  private rowToDto(
    r: {
      id: string;
      employeeId: string;
      employeeName: string;
      employeeNumber: string;
      workDate: string;
      status: string;
      checkInAt: Date | null;
      checkOutAt: Date | null;
      gpsDistanceM: string | null;
      source: string;
      notes: string | null;
    },
    correctionCount: number,
  ): AttendanceRecordDto {
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      employeeNumber: r.employeeNumber,
      workDate: r.workDate,
      status: r.status,
      checkInAt: r.checkInAt?.toISOString() ?? null,
      checkOutAt: r.checkOutAt?.toISOString() ?? null,
      gpsDistanceM: r.gpsDistanceM,
      source: r.source,
      notes: r.notes,
      correctionCount,
    };
  }

  private async toDto(tx: Tx, tenantId: string, id: string): Promise<AttendanceRecordDto> {
    const [row] = await tx
      .select(this.cols())
      .from(attendanceRecords)
      .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
      .where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.id, id)))
      .limit(1);
    if (!row) throw new AppError('HR_ATTENDANCE_NOT_FOUND');
    const c = await this.correctionCounts(tx, tenantId, [id]);
    return this.rowToDto(row, c.get(id) ?? 0);
  }

  private async correctionCounts(
    tx: Tx,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({
        rid: attendanceCorrections.attendanceRecordId,
        n: sql<number>`count(*)::int`,
      })
      .from(attendanceCorrections)
      .where(
        and(
          eq(attendanceCorrections.tenantId, tenantId),
          inArray(attendanceCorrections.attendanceRecordId, ids),
        ),
      )
      .groupBy(attendanceCorrections.attendanceRecordId);
    return new Map(rows.map((r) => [r.rid, r.n]));
  }

  private async requireEmployee(tx: Tx, tenantId: string, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
      .limit(1);
    if (!row) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
  }
}
