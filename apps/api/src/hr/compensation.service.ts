import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { HrScope } from './common.js';
import type { CompensationDto, CreateCompensationDto } from './hr.dto.js';

const { compensationProfiles, compensationComponents, employmentHistory, employees } = schema;

/**
 * Compensation (Phase 12, ADR 0041) — HIGHLY SENSITIVE, gated by
 * `hr.compensation.*`, never in list DTOs / audit metadata / notifications.
 * Compensation is HISTORICAL: a new effective-dated profile supersedes the
 * previous one; old profiles are kept (status SUPERSEDED), never overwritten.
 */
@Injectable()
export class CompensationService {
  constructor(private readonly audit: AuditService) {}

  /** All compensation profiles for an employee, newest first. */
  history(scope: HrScope, employeeId: string): Promise<CompensationDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, employeeId);
      const profiles = await tx
        .select()
        .from(compensationProfiles)
        .where(
          and(
            eq(compensationProfiles.tenantId, scope.tenantId),
            eq(compensationProfiles.employeeId, employeeId),
          ),
        )
        .orderBy(desc(compensationProfiles.effectiveDate));
      if (profiles.length === 0) return [];
      const comps = await tx
        .select()
        .from(compensationComponents)
        .where(eq(compensationComponents.tenantId, scope.tenantId));
      const byProfile = new Map<string, schema.CompensationComponentRow[]>();
      for (const c of comps) {
        const arr = byProfile.get(c.compensationProfileId) ?? [];
        arr.push(c);
        byProfile.set(c.compensationProfileId, arr);
      }
      return profiles.map((p) => this.toDto(p, byProfile.get(p.id) ?? []));
    });
  }

  /** The employee's current (latest ACTIVE) compensation, or null. */
  current(scope: HrScope, employeeId: string): Promise<CompensationDto | null> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, employeeId);
      return this.loadCurrent(tx, scope.tenantId, employeeId);
    });
  }

  async create(
    scope: HrScope,
    employeeId: string,
    body: CreateCompensationDto,
  ): Promise<CompensationDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, employeeId);
      const prev = await this.loadCurrent(tx, scope.tenantId, employeeId);
      // supersede any active profile
      await tx
        .update(compensationProfiles)
        .set({ status: 'SUPERSEDED', updatedAt: new Date() })
        .where(
          and(
            eq(compensationProfiles.tenantId, scope.tenantId),
            eq(compensationProfiles.employeeId, employeeId),
            eq(compensationProfiles.status, 'ACTIVE'),
          ),
        );
      const [row] = await tx
        .insert(compensationProfiles)
        .values({
          tenantId: scope.tenantId,
          employeeId,
          effectiveDate: body.effectiveDate.slice(0, 10),
          payFrequency: (body.payFrequency as 'MONTHLY') ?? 'MONTHLY',
          currency: (body.currency ?? 'INR').toUpperCase(),
          baseSalary: body.baseSalary,
          status: 'ACTIVE',
          notes: body.notes ?? null,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: compensationProfiles.id });
      for (const c of body.components ?? []) {
        await tx.insert(compensationComponents).values({
          tenantId: scope.tenantId,
          compensationProfileId: row!.id,
          kind: c.kind as 'EARNING',
          name: c.name.trim(),
          amount: c.amount,
        });
      }
      await tx.insert(employmentHistory).values({
        tenantId: scope.tenantId,
        employeeId,
        changeType: 'COMPENSATION',
        effectiveDate: body.effectiveDate.slice(0, 10),
        // NEVER store salary figures in history metadata — just that it changed
        fromValue: prev ? { hadCompensation: true, effectiveDate: prev.effectiveDate } : null,
        toValue: {
          effectiveDate: body.effectiveDate.slice(0, 10),
          payFrequency: body.payFrequency ?? 'MONTHLY',
        },
        reason: body.notes ?? null,
        changedByMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: prev ? 'hr.compensation.changed' : 'hr.compensation.created',
        entityType: 'compensation_profile',
        entityId: row!.id,
        actor: userActor(scope),
        // no salary amounts in audit metadata
        metadata: {
          employeeId,
          effectiveDate: body.effectiveDate.slice(0, 10),
          payFrequency: body.payFrequency ?? 'MONTHLY',
        },
      });
      return row!.id;
    });
    return (await this.history(scope, employeeId)).find((c) => c.id === id)!;
  }

  private async loadCurrent(
    tx: Tx,
    tenantId: string,
    employeeId: string,
  ): Promise<CompensationDto | null> {
    const [p] = await tx
      .select()
      .from(compensationProfiles)
      .where(
        and(
          eq(compensationProfiles.tenantId, tenantId),
          eq(compensationProfiles.employeeId, employeeId),
          eq(compensationProfiles.status, 'ACTIVE'),
        ),
      )
      .orderBy(desc(compensationProfiles.effectiveDate))
      .limit(1);
    if (!p) return null;
    const comps = await tx
      .select()
      .from(compensationComponents)
      .where(
        and(
          eq(compensationComponents.tenantId, tenantId),
          eq(compensationComponents.compensationProfileId, p.id),
        ),
      );
    return this.toDto(p, comps);
  }

  private toDto(
    p: schema.CompensationProfileRow,
    comps: schema.CompensationComponentRow[],
  ): CompensationDto {
    return {
      id: p.id,
      effectiveDate: p.effectiveDate,
      payFrequency: p.payFrequency,
      currency: p.currency,
      baseSalary: p.baseSalary,
      status: p.status,
      components: comps.map((c) => ({ kind: c.kind, name: c.name, amount: c.amount })),
      createdAt: p.createdAt.toISOString(),
    };
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
