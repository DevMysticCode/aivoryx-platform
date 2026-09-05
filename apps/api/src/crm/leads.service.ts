import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { recordActivity } from './activities.js';
import { isValidLeadTransition, type LeadStatus } from './lead-lifecycle.js';
import { normalizeEmail, normalizePhone } from './lead-normalization.js';
import {
  listLeads,
  loadLeadView,
  membershipExistsInTenant,
  type ListLeadsFilter,
  type ListLeadsResult,
  type LeadView,
} from './lead-queries.js';
import { writeCustomFieldValues, type CustomFieldInputValue } from './custom-fields.service.js';

const { leads } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  /** the caller's own membership — recorded as the activity actor */
  actorMembershipId: string;
}

export interface LeadContactInput {
  name?: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  customFields?: Record<string, CustomFieldInputValue>;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  list(scope: TenantScope, filter: ListLeadsFilter): Promise<ListLeadsResult> {
    return withTenantContext(getDb(), scope, (tx) => listLeads(tx, scope.tenantId, filter));
  }

  async get(scope: TenantScope, leadId: string): Promise<LeadView> {
    const view = await withTenantContext(getDb(), scope, (tx) =>
      loadLeadView(tx, scope.tenantId, leadId),
    );
    if (!view) throw new AppError('LEAD_NOT_FOUND');
    return view;
  }

  async create(scope: TenantScope, input: LeadContactInput): Promise<LeadView> {
    const leadId = await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .insert(leads)
        .values({
          tenantId: scope.tenantId,
          name: input.name ?? null,
          phone: input.phone ?? null,
          normalizedPhone: normalizePhone(input.phone),
          email: input.email ?? null,
          normalizedEmail: normalizeEmail(input.email),
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          country: input.country ?? null,
        })
        .returning({ id: leads.id });
      const id = row!.id;

      if (input.customFields) {
        await writeCustomFieldValues(tx, scope.tenantId, id, input.customFields);
      }
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId: id,
        type: 'created',
        actorMembershipId: scope.actorMembershipId,
        payload: {},
      });
      return id;
    });
    return this.get(scope, leadId);
  }

  async update(scope: TenantScope, leadId: string, patch: LeadContactInput): Promise<LeadView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireLead(tx, scope.tenantId, leadId);
      const nextPhone = patch.phone !== undefined ? patch.phone : current.phone;
      const nextEmail = patch.email !== undefined ? patch.email : current.email;

      await tx
        .update(leads)
        .set({
          name: patch.name !== undefined ? patch.name : current.name,
          phone: nextPhone,
          normalizedPhone: normalizePhone(nextPhone),
          email: nextEmail,
          normalizedEmail: normalizeEmail(nextEmail),
          addressLine: patch.addressLine !== undefined ? patch.addressLine : current.addressLine,
          city: patch.city !== undefined ? patch.city : current.city,
          state: patch.state !== undefined ? patch.state : current.state,
          postalCode: patch.postalCode !== undefined ? patch.postalCode : current.postalCode,
          country: patch.country !== undefined ? patch.country : current.country,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));

      if (patch.customFields) {
        await writeCustomFieldValues(tx, scope.tenantId, leadId, patch.customFields);
      }
    });
    return this.get(scope, leadId);
  }

  /** Assign or reassign. Bumps NEW -> ASSIGNED; leaves a later status untouched. */
  async assign(scope: TenantScope, leadId: string, membershipId: string): Promise<LeadView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireLead(tx, scope.tenantId, leadId);
      const target = await membershipExistsInTenant(tx, scope.tenantId, membershipId);
      if (!target) throw new AppError('LEAD_ASSIGNEE_INVALID');

      const fromMembershipId = current.assignedMembershipId;
      const nextStatus: LeadStatus = current.status === 'NEW' ? 'ASSIGNED' : current.status;

      await tx
        .update(leads)
        .set({ assignedMembershipId: membershipId, status: nextStatus, updatedAt: new Date() })
        .where(eq(leads.id, leadId));

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId,
        type: fromMembershipId ? 'reassigned' : 'assigned',
        actorMembershipId: scope.actorMembershipId,
        payload: { from: fromMembershipId, to: membershipId },
      });
      if (nextStatus !== current.status) {
        await recordActivity(tx, {
          tenantId: scope.tenantId,
          leadId,
          type: 'status_changed',
          actorMembershipId: scope.actorMembershipId,
          payload: { from: current.status, to: nextStatus },
        });
      }
    });
    return this.get(scope, leadId);
  }

  /** Generic (non-qualification) status transition, e.g. marking a lead CONTACTED. */
  async transitionStatus(
    scope: TenantScope,
    leadId: string,
    toStatus: LeadStatus,
  ): Promise<LeadView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireLead(tx, scope.tenantId, leadId);
      if (!isValidLeadTransition(current.status, toStatus)) {
        throw new AppError('LEAD_INVALID_TRANSITION', {
          details: { from: current.status, to: toStatus },
        });
      }
      await tx
        .update(leads)
        .set({ status: toStatus, updatedAt: new Date() })
        .where(eq(leads.id, leadId));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId,
        type: 'status_changed',
        actorMembershipId: scope.actorMembershipId,
        payload: { from: current.status, to: toStatus },
      });
    });
    return this.get(scope, leadId);
  }

  async qualify(
    scope: TenantScope,
    leadId: string,
    outcome: Extract<LeadStatus, 'QUALIFIED' | 'DISQUALIFIED'>,
    note?: string,
  ): Promise<LeadView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await this.requireLead(tx, scope.tenantId, leadId);
      if (!isValidLeadTransition(current.status, outcome)) {
        throw new AppError('LEAD_INVALID_TRANSITION', {
          details: { from: current.status, to: outcome },
        });
      }
      await tx
        .update(leads)
        .set({ status: outcome, qualificationNote: note ?? null, updatedAt: new Date() })
        .where(eq(leads.id, leadId));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId,
        type: outcome === 'QUALIFIED' ? 'qualified' : 'disqualified',
        actorMembershipId: scope.actorMembershipId,
        payload: { from: current.status, note: note ?? null },
      });
    });
    return this.get(scope, leadId);
  }

  /** Manual call logging (phase brief §4 — no telephony integration yet). */
  async logCallAttempt(
    scope: TenantScope,
    leadId: string,
    outcome: string,
    note?: string,
  ): Promise<LeadView> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireLead(tx, scope.tenantId, leadId);
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId,
        type: 'call_attempt',
        actorMembershipId: scope.actorMembershipId,
        payload: { outcome, note: note ?? null },
      });
    });
    return this.get(scope, leadId);
  }

  // ---- helpers --------------------------------------------------------

  private async requireLead(
    tx: Tx,
    tenantId: string,
    leadId: string,
  ): Promise<{
    status: LeadStatus;
    assignedMembershipId: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  }> {
    const [row] = await tx
      .select({
        status: leads.status,
        assignedMembershipId: leads.assignedMembershipId,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        addressLine: leads.addressLine,
        city: leads.city,
        state: leads.state,
        postalCode: leads.postalCode,
        country: leads.country,
      })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new AppError('LEAD_NOT_FOUND');
    return row;
  }
}
