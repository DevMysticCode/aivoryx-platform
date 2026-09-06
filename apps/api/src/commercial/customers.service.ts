import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { normalizeEmail, normalizePhone } from '../crm/lead-normalization.js';
import { isUniqueViolation, pageBounds, type TenantScope } from '../supply/common.js';
import type {
  CreateCustomerDto,
  CustomerDetailDto,
  CustomerDto,
  CustomerListDto,
  UpdateCustomerDto,
} from './commercial.dto.js';

const { customers, leads, quotations, projects } = schema;

function toDto(row: typeof customers.$inferSelect): CustomerDto {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    phone: row.phone,
    email: row.email,
    addressLine: row.addressLine,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    siteAddressLine: row.siteAddressLine,
    siteCity: row.siteCity,
    siteState: row.siteState,
    taxReference: row.taxReference,
    notes: row.notes,
    status: row.status,
    leadId: row.leadId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function nextCustomerNumber(tx: Tx, tenantId: string, requested?: string): Promise<string> {
  if (requested?.trim()) return requested.trim();
  return `CUST-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * The commercial party model (Phase 6, ADR 0035). A customer is the smallest
 * reusable reference — name, contact, address, tax ref, status — not an ERP
 * customer master. A lead is *promoted* to a customer (carrying `leadId`)
 * rather than its data being copied into an unrelated record.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly outbox: OutboxService) {}

  async list(
    scope: TenantScope,
    filter: { q?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<CustomerListDto> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(customers.tenantId, scope.tenantId)];
      if (filter.status) conds.push(eq(customers.status, filter.status as 'prospect'));
      if (filter.q?.trim()) {
        const like = `%${filter.q.trim()}%`;
        conds.push(
          or(
            ilike(customers.name, like),
            ilike(customers.number, like),
            ilike(customers.phone, like),
            ilike(customers.email, like),
          )!,
        );
      }
      const where = and(...conds);
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(customers)
        .where(where);
      const rows = await tx
        .select()
        .from(customers)
        .where(where)
        .orderBy(desc(customers.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { items: rows.map(toDto), total: countRow?.n ?? 0, page, pageSize };
    });
  }

  async get(scope: TenantScope, id: string): Promise<CustomerDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const row = await loadCustomer(tx, scope.tenantId, id);
      if (!row) throw new AppError('CUSTOMER_NOT_FOUND');
      const leadRows = row.leadId
        ? await tx
            .select({ id: leads.id, name: leads.name, status: leads.status })
            .from(leads)
            .where(and(eq(leads.tenantId, scope.tenantId), eq(leads.id, row.leadId)))
        : [];
      const quoteRows = await tx
        .select({ id: quotations.id, number: quotations.number, status: quotations.status })
        .from(quotations)
        .where(and(eq(quotations.tenantId, scope.tenantId), eq(quotations.customerId, id)))
        .orderBy(desc(quotations.createdAt));
      const projectRows = await tx
        .select({ id: projects.id, number: projects.number, status: projects.status })
        .from(projects)
        .innerJoin(
          quotations,
          and(eq(quotations.projectId, projects.id), eq(quotations.tenantId, projects.tenantId)),
        )
        .where(and(eq(projects.tenantId, scope.tenantId), eq(quotations.customerId, id)));
      return {
        ...toDto(row),
        leads: leadRows.map((l) => ({
          id: l.id,
          label: l.name ?? l.id.slice(0, 8),
          status: l.status,
        })),
        quotations: quoteRows.map((q) => ({ id: q.id, label: q.number, status: q.status })),
        projects: projectRows.map((p) => ({ id: p.id, label: p.number, status: p.status })),
      };
    });
  }

  async create(scope: TenantScope, body: CreateCustomerDto): Promise<CustomerDetailDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const number = await nextCustomerNumber(tx, scope.tenantId, body.number);
      try {
        const [row] = await tx
          .insert(customers)
          .values({
            tenantId: scope.tenantId,
            number,
            name: body.name,
            phone: body.phone ?? null,
            normalizedPhone: normalizePhone(body.phone),
            email: body.email ?? null,
            normalizedEmail: normalizeEmail(body.email),
            addressLine: body.addressLine ?? null,
            city: body.city ?? null,
            state: body.state ?? null,
            postalCode: body.postalCode ?? null,
            country: body.country ?? null,
            siteAddressLine: body.siteAddressLine ?? null,
            siteCity: body.siteCity ?? null,
            siteState: body.siteState ?? null,
            taxReference: body.taxReference ?? null,
            notes: body.notes ?? null,
            status: 'prospect',
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: customers.id });
        const created = row!.id;
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'customer.created',
          payload: { customerId: created, number, source: 'manual' },
        });
        return created;
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('DUPLICATE_CODE', { details: { number } });
        throw err;
      }
    });
    return this.get(scope, id);
  }

  async update(
    scope: TenantScope,
    id: string,
    body: UpdateCustomerDto,
  ): Promise<CustomerDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const row = await loadCustomer(tx, scope.tenantId, id);
      if (!row) throw new AppError('CUSTOMER_NOT_FOUND');
      await tx
        .update(customers)
        .set({
          name: body.name ?? undefined,
          phone: body.phone ?? undefined,
          normalizedPhone: body.phone !== undefined ? normalizePhone(body.phone) : undefined,
          email: body.email ?? undefined,
          normalizedEmail: body.email !== undefined ? normalizeEmail(body.email) : undefined,
          addressLine: body.addressLine ?? undefined,
          city: body.city ?? undefined,
          state: body.state ?? undefined,
          postalCode: body.postalCode ?? undefined,
          country: body.country ?? undefined,
          siteAddressLine: body.siteAddressLine ?? undefined,
          siteCity: body.siteCity ?? undefined,
          siteState: body.siteState ?? undefined,
          taxReference: body.taxReference ?? undefined,
          notes: body.notes ?? undefined,
          status: body.status ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(customers.id, id), eq(customers.tenantId, scope.tenantId)));
    });
    return this.get(scope, id);
  }

  /** Promote a CRM lead to a customer. Idempotent per lead — a second call
   *  returns the customer already promoted from that lead. */
  async promoteFromLead(
    scope: TenantScope,
    leadId: string,
    requestedNumber?: string,
  ): Promise<CustomerDetailDto> {
    const id = await withTenantContext(getDb(), scope, (tx) =>
      promoteLeadTx(tx, this.outbox, scope, leadId, requestedNumber),
    );
    return this.get(scope, id);
  }
}

// ---- shared helpers (also used by the booking transaction) --------

export async function loadCustomer(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<typeof customers.$inferSelect | undefined> {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
  return row;
}

/**
 * Promote a lead to a customer inside an existing tenant-context transaction.
 * Idempotent: if a customer already carries this `leadId`, it is returned and
 * (re)activated instead of a second record being created.
 */
export async function promoteLeadTx(
  tx: Tx,
  outbox: OutboxService,
  scope: TenantScope,
  leadId: string,
  requestedNumber?: string,
): Promise<string> {
  const [lead] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, scope.tenantId)));
  if (!lead) throw new AppError('LEAD_NOT_FOUND');

  const [existing] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.leadId, leadId)))
    .limit(1);
  if (existing) {
    await tx
      .update(customers)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(customers.id, existing.id));
    return existing.id;
  }

  const number = requestedNumber?.trim() || `CUST-${randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    const [row] = await tx
      .insert(customers)
      .values({
        tenantId: scope.tenantId,
        number,
        name: lead.name ?? lead.phone ?? lead.email ?? 'Customer',
        phone: lead.phone,
        normalizedPhone: lead.normalizedPhone,
        email: lead.email,
        normalizedEmail: lead.normalizedEmail,
        addressLine: lead.addressLine,
        city: lead.city,
        state: lead.state,
        postalCode: lead.postalCode,
        country: lead.country,
        siteAddressLine: lead.addressLine,
        siteCity: lead.city,
        siteState: lead.state,
        status: 'active',
        leadId,
        createdByMembershipId: scope.actorMembershipId,
      })
      .returning({ id: customers.id });
    const created = row!.id;
    await outbox.emit(tx, {
      tenantId: scope.tenantId,
      type: 'customer.created',
      payload: { customerId: created, number, source: 'lead_promotion', leadId },
    });
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('DUPLICATE_CODE', { details: { number } });
    throw err;
  }
}
