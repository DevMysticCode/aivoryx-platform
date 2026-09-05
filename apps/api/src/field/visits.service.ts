import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { leadExists } from '../crm/lead-queries.js';
import {
  loadActiveCustomFieldDefsWithMeta,
  loadCustomFieldValuesForEntity,
  writeCustomFieldValues,
  type CustomFieldInputValue,
} from '../crm/custom-fields.service.js';
import { computeGpsDistanceMeters } from './distance.js';
import { isActiveFieldAgent } from './field-agents.service.js';
import {
  canReassignOrReschedule,
  isValidVisitTransition,
  type VisitStatus,
} from './visit-lifecycle.js';
import { recordLeadVisitMilestone, recordVisitActivity } from './visit-activities.js';
import {
  listVisits,
  loadVisitView,
  type ListVisitsFilter,
  type ListVisitsResult,
  type VisitView,
} from './visit-queries.js';

const { visits } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
}

/** Whether the caller sees every tenant visit (`crm.leads.read`) or only
 *  their own assigned visits — enforced server-side, never from client input. */
export interface VisitVisibility {
  canSeeAll: boolean;
}

export interface ScheduleVisitInput {
  leadId: string;
  scheduledAt: string;
  assignedMembershipId?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  siteLat?: number;
  siteLng?: number;
}

export interface GeoPointInput {
  lat: number;
  lng: number;
  accuracyM?: number;
}

@Injectable()
export class VisitsService {
  constructor(private readonly outbox: OutboxService) {}

  async list(
    scope: TenantScope,
    filter: ListVisitsFilter,
    visibility: VisitVisibility,
  ): Promise<ListVisitsResult> {
    const effective: ListVisitsFilter = visibility.canSeeAll
      ? filter
      : { ...filter, assignedMembershipId: scope.actorMembershipId };
    return withTenantContext(getDb(), scope, (tx) => listVisits(tx, scope.tenantId, effective));
  }

  async get(scope: TenantScope, visitId: string, visibility: VisitVisibility): Promise<VisitView> {
    const view = await withTenantContext(getDb(), scope, (tx) =>
      loadVisitView(tx, scope.tenantId, visitId),
    );
    if (!view) throw new AppError('VISIT_NOT_FOUND');
    this.assertVisible(view, scope, visibility);
    return view;
  }

  async schedule(scope: TenantScope, input: ScheduleVisitInput): Promise<VisitView> {
    const visitId = await withTenantContext(getDb(), scope, async (tx) => {
      if (!(await leadExists(tx, scope.tenantId, input.leadId))) {
        throw new AppError('LEAD_NOT_FOUND');
      }
      if (input.assignedMembershipId) {
        await this.requireActiveFieldAgent(tx, scope.tenantId, input.assignedMembershipId);
      }

      const [row] = await tx
        .insert(visits)
        .values({
          tenantId: scope.tenantId,
          leadId: input.leadId,
          assignedMembershipId: input.assignedMembershipId ?? null,
          status: input.assignedMembershipId ? 'ASSIGNED' : 'SCHEDULED',
          scheduledAt: new Date(input.scheduledAt),
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          country: input.country ?? null,
          siteLat: input.siteLat !== undefined ? String(input.siteLat) : null,
          siteLng: input.siteLng !== undefined ? String(input.siteLng) : null,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: visits.id });
      const id = row!.id;

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId: id,
        type: 'created',
        actorMembershipId: scope.actorMembershipId,
        payload: { leadId: input.leadId },
      });
      if (input.assignedMembershipId) {
        await recordVisitActivity(tx, {
          tenantId: scope.tenantId,
          visitId: id,
          type: 'assigned',
          actorMembershipId: scope.actorMembershipId,
          payload: { to: input.assignedMembershipId },
        });
      }
      await recordLeadVisitMilestone(tx, {
        tenantId: scope.tenantId,
        leadId: input.leadId,
        type: 'visit_scheduled',
        actorMembershipId: scope.actorMembershipId,
        payload: { visitId: id, scheduledAt: input.scheduledAt },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'visit.created',
        payload: { visitId: id, leadId: input.leadId },
      });
      if (input.assignedMembershipId) {
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'visit.assigned',
          payload: { visitId: id, membershipId: input.assignedMembershipId },
        });
      }
      return id;
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  async assign(scope: TenantScope, visitId: string, membershipId: string): Promise<VisitView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireVisit(tx, scope.tenantId, visitId);
      if (!canReassignOrReschedule(current.status)) {
        throw new AppError('VISIT_INVALID_TRANSITION', {
          details: { from: current.status, action: 'assign' },
        });
      }
      await this.requireActiveFieldAgent(tx, scope.tenantId, membershipId);

      const wasAssigned = current.assignedMembershipId !== null;
      const nextStatus = current.status === 'SCHEDULED' ? 'ASSIGNED' : current.status;

      await tx
        .update(visits)
        .set({ assignedMembershipId: membershipId, status: nextStatus, updatedAt: new Date() })
        .where(and(eq(visits.id, visitId), eq(visits.tenantId, scope.tenantId)));

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: wasAssigned ? 'reassigned' : 'assigned',
        actorMembershipId: scope.actorMembershipId,
        payload: { from: current.assignedMembershipId, to: membershipId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'visit.assigned',
        payload: { visitId, membershipId },
      });
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  async reschedule(scope: TenantScope, visitId: string, scheduledAt: string): Promise<VisitView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireVisit(tx, scope.tenantId, visitId);
      if (!canReassignOrReschedule(current.status)) {
        throw new AppError('VISIT_INVALID_TRANSITION', {
          details: { from: current.status, action: 'reschedule' },
        });
      }
      await tx
        .update(visits)
        .set({ scheduledAt: new Date(scheduledAt), updatedAt: new Date() })
        .where(and(eq(visits.id, visitId), eq(visits.tenantId, scope.tenantId)));

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'rescheduled',
        actorMembershipId: scope.actorMembershipId,
        payload: { from: current.scheduledAt.toISOString(), to: scheduledAt },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'visit.rescheduled',
        payload: { visitId, scheduledAt },
      });
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  async cancel(scope: TenantScope, visitId: string, reason?: string): Promise<VisitView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireVisit(tx, scope.tenantId, visitId);
      if (!isValidVisitTransition(current.status, 'CANCELLED')) {
        throw new AppError('VISIT_INVALID_TRANSITION', {
          details: { from: current.status, to: 'CANCELLED' },
        });
      }
      await tx
        .update(visits)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(and(eq(visits.id, visitId), eq(visits.tenantId, scope.tenantId)));

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'cancelled',
        actorMembershipId: scope.actorMembershipId,
        payload: { reason: reason ?? null },
      });
      await recordLeadVisitMilestone(tx, {
        tenantId: scope.tenantId,
        leadId: current.leadId,
        type: 'visit_cancelled',
        actorMembershipId: scope.actorMembershipId,
        payload: { visitId },
      });
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  /** Idempotent: repeated check-in on an already-checked-in visit returns the
   *  existing state rather than erroring (Phase 4 §16 — not security-sensitive
   *  the way a one-time invitation token is). */
  async checkIn(scope: TenantScope, visitId: string, point: GeoPointInput): Promise<VisitView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireVisit(tx, scope.tenantId, visitId);
      this.assertOwnAssignment(current, scope);

      if (current.status === 'IN_PROGRESS' && current.checkInAt) return; // idempotent no-op
      if (current.status !== 'ASSIGNED') {
        throw new AppError('VISIT_INVALID_TRANSITION', {
          details: { from: current.status, action: 'check-in' },
        });
      }

      const [row] = await tx
        .update(visits)
        .set({
          status: 'IN_PROGRESS',
          checkInAt: sql`now()`,
          checkInLat: String(point.lat),
          checkInLng: String(point.lng),
          checkInAccuracyM: point.accuracyM !== undefined ? String(point.accuracyM) : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(visits.id, visitId),
            eq(visits.tenantId, scope.tenantId),
            eq(visits.status, 'ASSIGNED'),
            isNull(visits.checkInAt),
          ),
        )
        .returning({ id: visits.id });
      if (!row) return; // lost the race to a concurrent duplicate request — idempotent no-op

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'checked_in',
        actorMembershipId: scope.actorMembershipId,
        payload: { lat: point.lat, lng: point.lng, accuracyM: point.accuracyM ?? null },
      });
      await recordLeadVisitMilestone(tx, {
        tenantId: scope.tenantId,
        leadId: current.leadId,
        type: 'visit_checked_in',
        actorMembershipId: scope.actorMembershipId,
        payload: { visitId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'visit.checked_in',
        payload: { visitId },
      });
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  async checkOut(
    scope: TenantScope,
    visitId: string,
    point: GeoPointInput & { travelKm?: number; travelNotes?: string },
  ): Promise<VisitView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireVisit(tx, scope.tenantId, visitId);
      this.assertOwnAssignment(current, scope);

      if (current.status === 'IN_PROGRESS' && current.checkOutAt) return; // idempotent no-op
      if (current.status !== 'IN_PROGRESS' || !current.checkInAt) {
        throw new AppError('VISIT_NOT_CHECKED_IN');
      }

      const gpsDistanceMeters = computeGpsDistanceMeters(
        current.siteLat !== null && current.siteLng !== null
          ? { lat: current.siteLat, lng: current.siteLng }
          : null,
        { lat: point.lat, lng: point.lng },
      );

      const [row] = await tx
        .update(visits)
        .set({
          checkOutAt: sql`now()`,
          checkOutLat: String(point.lat),
          checkOutLng: String(point.lng),
          checkOutAccuracyM: point.accuracyM !== undefined ? String(point.accuracyM) : null,
          gpsDistanceMeters: gpsDistanceMeters !== null ? String(gpsDistanceMeters) : null,
          travelKm: point.travelKm !== undefined ? String(point.travelKm) : null,
          travelNotes: point.travelNotes ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(visits.id, visitId),
            eq(visits.tenantId, scope.tenantId),
            eq(visits.status, 'IN_PROGRESS'),
            isNull(visits.checkOutAt),
          ),
        )
        .returning({ id: visits.id });
      if (!row) return; // lost the race — idempotent no-op

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'checked_out',
        actorMembershipId: scope.actorMembershipId,
        payload: { lat: point.lat, lng: point.lng, gpsDistanceMeters },
      });
      await recordLeadVisitMilestone(tx, {
        tenantId: scope.tenantId,
        leadId: current.leadId,
        type: 'visit_checked_out',
        actorMembershipId: scope.actorMembershipId,
        payload: { visitId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'visit.checked_out',
        payload: { visitId },
      });
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  async submitSurvey(
    scope: TenantScope,
    visitId: string,
    values: Record<string, CustomFieldInputValue>,
  ): Promise<VisitView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireVisit(tx, scope.tenantId, visitId);
      this.assertOwnAssignment(current, scope);
      if (current.status !== 'IN_PROGRESS') {
        throw new AppError('VISIT_INVALID_TRANSITION', {
          details: { from: current.status, action: 'survey' },
        });
      }

      await writeCustomFieldValues(tx, scope.tenantId, visitId, values, 'visit');

      if (!current.surveyCompletedAt) {
        const complete = await this.isSurveyComplete(tx, scope.tenantId, visitId);
        if (complete) {
          await tx
            .update(visits)
            .set({ surveyCompletedAt: sql`now()`, updatedAt: new Date() })
            .where(and(eq(visits.id, visitId), eq(visits.tenantId, scope.tenantId)));
          await recordVisitActivity(tx, {
            tenantId: scope.tenantId,
            visitId,
            type: 'survey_completed',
            actorMembershipId: scope.actorMembershipId,
          });
          await recordLeadVisitMilestone(tx, {
            tenantId: scope.tenantId,
            leadId: current.leadId,
            type: 'visit_survey_completed',
            actorMembershipId: scope.actorMembershipId,
            payload: { visitId },
          });
          await this.outbox.emit(tx, {
            tenantId: scope.tenantId,
            type: 'survey.completed',
            payload: { visitId },
          });
        } else {
          await recordVisitActivity(tx, {
            tenantId: scope.tenantId,
            visitId,
            type: 'survey_started',
            actorMembershipId: scope.actorMembershipId,
          });
        }
      }
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  async getSurvey(scope: TenantScope, visitId: string, visibility: VisitVisibility) {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.get(scope, visitId, visibility);
      return loadCustomFieldValuesForEntity(tx, scope.tenantId, 'visit', visitId);
    });
  }

  async complete(scope: TenantScope, visitId: string): Promise<VisitView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireVisit(tx, scope.tenantId, visitId);
      this.assertOwnAssignment(current, scope);
      if (!isValidVisitTransition(current.status, 'COMPLETED')) {
        throw new AppError('VISIT_INVALID_TRANSITION', {
          details: { from: current.status, to: 'COMPLETED' },
        });
      }
      const missing: string[] = [];
      if (!current.checkInAt) missing.push('check_in');
      if (!current.checkOutAt) missing.push('check_out');
      const surveyComplete =
        current.surveyCompletedAt !== null ||
        (await this.isSurveyComplete(tx, scope.tenantId, visitId));
      if (!surveyComplete) missing.push('survey');
      if (missing.length > 0) throw new AppError('VISIT_INCOMPLETE', { details: { missing } });

      await tx
        .update(visits)
        .set({ status: 'COMPLETED', updatedAt: new Date() })
        .where(and(eq(visits.id, visitId), eq(visits.tenantId, scope.tenantId)));

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'completed',
        actorMembershipId: scope.actorMembershipId,
      });
      await recordLeadVisitMilestone(tx, {
        tenantId: scope.tenantId,
        leadId: current.leadId,
        type: 'visit_completed',
        actorMembershipId: scope.actorMembershipId,
        payload: { visitId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'visit.completed',
        payload: { visitId },
      });
    });
    return this.get(scope, visitId, { canSeeAll: true });
  }

  // ---- helpers --------------------------------------------------------

  private assertVisible(view: VisitView, scope: TenantScope, visibility: VisitVisibility): void {
    if (visibility.canSeeAll) return;
    if (view.assignee?.membershipId !== scope.actorMembershipId) {
      throw new AppError('VISIT_NOT_ASSIGNED_TO_YOU');
    }
  }

  private assertOwnAssignment(
    current: { assignedMembershipId: string | null },
    scope: TenantScope,
  ): void {
    if (current.assignedMembershipId !== scope.actorMembershipId) {
      throw new AppError('VISIT_NOT_ASSIGNED_TO_YOU');
    }
  }

  private async isSurveyComplete(tx: Tx, tenantId: string, visitId: string): Promise<boolean> {
    const defs = await loadActiveCustomFieldDefsWithMeta(tx, tenantId, 'visit');
    const required = defs.filter((d) => d.isRequired);
    if (required.length === 0) return true;
    const values = await loadCustomFieldValuesForEntity(tx, tenantId, 'visit', visitId);
    const byKey = new Map(values.map((v) => [v.key, v.value]));
    return required.every((d) => {
      const v = byKey.get(d.key);
      return v !== undefined && v !== null && v !== '';
    });
  }

  private async requireActiveFieldAgent(
    tx: Tx,
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    if (!(await isActiveFieldAgent(tx, tenantId, membershipId))) {
      throw new AppError('FIELD_AGENT_NOT_FOUND', { details: { membershipId } });
    }
  }

  private async requireVisit(
    tx: Tx,
    tenantId: string,
    visitId: string,
  ): Promise<{
    status: VisitStatus;
    leadId: string;
    assignedMembershipId: string | null;
    scheduledAt: Date;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    surveyCompletedAt: Date | null;
    siteLat: number | null;
    siteLng: number | null;
  }> {
    const [row] = await tx
      .select({
        status: visits.status,
        leadId: visits.leadId,
        assignedMembershipId: visits.assignedMembershipId,
        scheduledAt: visits.scheduledAt,
        checkInAt: visits.checkInAt,
        checkOutAt: visits.checkOutAt,
        surveyCompletedAt: visits.surveyCompletedAt,
        siteLat: visits.siteLat,
        siteLng: visits.siteLng,
      })
      .from(visits)
      .where(and(eq(visits.id, visitId), eq(visits.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new AppError('VISIT_NOT_FOUND');
    return {
      ...row,
      siteLat: row.siteLat !== null ? Number(row.siteLat) : null,
      siteLng: row.siteLng !== null ? Number(row.siteLng) : null,
    };
  }
}
