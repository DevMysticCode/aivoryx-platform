import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { DocumentRenderService } from '../documents/document-render.service.js';
import { buildQuotationDocument } from '../documents/builders.js';
import { isValidLeadTransition } from '../crm/lead-lifecycle.js';
import {
  OBJECT_STORAGE,
  buildEntityAttachmentKey,
  type ObjectStorageService,
} from '../storage/object-storage.service.js';
import { isUniqueViolation, pageBounds, type TenantScope } from '../supply/common.js';
import { lineAmounts, quoteTotals, type QuoteLineInput } from './money.js';
import {
  isValidQuotationTransition,
  quotationCanRevise,
  quotationIsEditable,
  type QuotationStatus,
} from './lifecycles.js';
import { loadCustomer, promoteLeadTx } from './customers.service.js';
import { renderQuotationHtml } from './quotation-doc.js';
import type {
  AcceptQuotationDto,
  BookingResultDto,
  BookQuotationDto,
  CreateQuotationDto,
  QuotationActivityDto,
  QuotationAttachmentDto,
  QuotationDetailDto,
  QuotationDto,
  QuotationLineDto,
  QuotationListDto,
  QuotationLineInputDto,
  QuotationRevisionDto,
  ReviseQuotationDto,
  UpdateQuotationDto,
} from './commercial.dto.js';

const {
  quotations,
  quotationRevisions,
  quotationLines,
  quotationActivities,
  quotationAttachments,
  customers,
  leads,
  leadActivities,
  projects,
  projectActivities,
  products,
  tenants,
  userTenantMemberships,
  users,
} = schema;

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

type QuotationActivityKind = (typeof quotationActivities.type.enumValues)[number];
type LeadActivityKind = (typeof leadActivities.type.enumValues)[number];

@Injectable()
export class QuotationsService {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
    private readonly documents: DocumentRenderService,
    private readonly audit: AuditService,
  ) {}

  /** Branded PDF of the quotation's current revision (Phase 10). */
  async renderPdf(scope: TenantScope, id: string): Promise<{ filename: string; body: Buffer }> {
    const detail = await this.get(scope, id);
    return this.documents.render(scope, buildQuotationDocument(detail));
  }

  // ---- reads ----------------------------------------------------

  async list(
    scope: TenantScope,
    filter: {
      status?: string;
      customerId?: string;
      leadId?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<QuotationListDto> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(quotations.tenantId, scope.tenantId)];
      if (filter.status) conds.push(eq(quotations.status, filter.status as QuotationStatus));
      if (filter.customerId) conds.push(eq(quotations.customerId, filter.customerId));
      if (filter.leadId) conds.push(eq(quotations.leadId, filter.leadId));
      if (filter.q?.trim()) conds.push(ilike(quotations.number, `%${filter.q.trim()}%`));
      const where = and(...conds);
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quotations)
        .where(where);
      const rows = await tx
        .select({
          q: quotations,
          leadName: leads.name,
          customerName: customers.name,
          projectNumber: projects.number,
          validityDate: quotationRevisions.validityDate,
          total: quotationRevisions.total,
        })
        .from(quotations)
        .leftJoin(leads, eq(leads.id, quotations.leadId))
        .leftJoin(customers, eq(customers.id, quotations.customerId))
        .leftJoin(projects, eq(projects.id, quotations.projectId))
        .leftJoin(
          quotationRevisions,
          and(
            eq(quotationRevisions.quotationId, quotations.id),
            eq(quotationRevisions.revisionNo, quotations.currentRevisionNo),
          ),
        )
        .where(where)
        .orderBy(desc(quotations.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) => ({
          ...toQuotationDto(r.q, r.leadName, r.customerName, r.projectNumber),
          validityDate: r.validityDate ? r.validityDate.toISOString() : null,
          total: r.total ?? '0.00',
        })),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async get(scope: TenantScope, id: string): Promise<QuotationDetailDto> {
    return withTenantContext(getDb(), scope, (tx) => this.loadDetail(tx, scope, id));
  }

  async listActivities(scope: TenantScope, id: string): Promise<QuotationActivityDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      if (!(await quotationExists(tx, scope.tenantId, id)))
        throw new AppError('QUOTATION_NOT_FOUND');
      const rows = await tx
        .select({ a: quotationActivities, actorName: users.name })
        .from(quotationActivities)
        .leftJoin(
          userTenantMemberships,
          eq(userTenantMemberships.id, quotationActivities.actorMembershipId),
        )
        .leftJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(
          and(
            eq(quotationActivities.tenantId, scope.tenantId),
            eq(quotationActivities.quotationId, id),
          ),
        )
        .orderBy(desc(quotationActivities.createdAt));
      return rows.map((r) => ({
        id: r.a.id,
        type: r.a.type,
        actorName: r.actorName,
        payload: (r.a.payload ?? {}) as Record<string, unknown>,
        createdAt: r.a.createdAt.toISOString(),
      }));
    });
  }

  async renderPrintable(scope: TenantScope, id: string): Promise<string> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const detail = await this.loadDetail(tx, scope, id);
      const [tenant] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, scope.tenantId));
      const customer = detail.customerId
        ? await loadCustomer(tx, scope.tenantId, detail.customerId)
        : undefined;
      return renderQuotationHtml({
        workspaceName: tenant?.name ?? 'Workspace',
        quotation: detail,
        customer: customer
          ? {
              name: customer.name,
              addressLine: customer.addressLine,
              city: customer.city,
              state: customer.state,
              taxReference: customer.taxReference,
              phone: customer.phone,
              email: customer.email,
            }
          : { name: detail.customerName ?? detail.leadName ?? 'Customer' },
      });
    });
  }

  // ---- writes -------------------------------------------------

  async create(scope: TenantScope, body: CreateQuotationDto): Promise<QuotationDetailDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const [lead] = await tx
        .select({ id: leads.id, name: leads.name })
        .from(leads)
        .where(and(eq(leads.id, body.leadId), eq(leads.tenantId, scope.tenantId)));
      if (!lead) throw new AppError('LEAD_NOT_FOUND');

      if (body.customerId) {
        const customer = await loadCustomer(tx, scope.tenantId, body.customerId);
        if (!customer) throw new AppError('CUSTOMER_NOT_FOUND');
      }
      if (body.projectId) {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, scope.tenantId)));
        if (!project) throw new AppError('PROJECT_NOT_FOUND');
      }

      const number = body.number?.trim() || `Q-${randomUUID().slice(0, 8).toUpperCase()}`;
      let quotationId: string;
      try {
        const [qRow] = await tx
          .insert(quotations)
          .values({
            tenantId: scope.tenantId,
            number,
            leadId: body.leadId,
            customerId: body.customerId ?? null,
            projectId: body.projectId ?? null,
            status: 'DRAFT',
            currentRevisionNo: 1,
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: quotations.id });
        quotationId = qRow!.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('DUPLICATE_CODE', { details: { number } });
        throw err;
      }

      const [rev] = await tx
        .insert(quotationRevisions)
        .values({
          tenantId: scope.tenantId,
          quotationId,
          revisionNo: 1,
          status: 'draft',
          issueDate: body.issueDate ? new Date(body.issueDate) : null,
          validityDate: body.validityDate ? new Date(body.validityDate) : null,
          notes: body.notes ?? null,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: quotationRevisions.id });

      if (body.lines?.length) {
        await this.writeLines(tx, scope, rev!.id, body.lines);
      }

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId,
        type: 'created',
        actorMembershipId: scope.actorMembershipId,
        payload: { number, leadId: body.leadId },
      });
      await recordLeadActivity(tx, {
        tenantId: scope.tenantId,
        leadId: body.leadId,
        type: 'quotation_created',
        actorMembershipId: scope.actorMembershipId,
        payload: { quotationId, number },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'quotation.created',
        payload: { quotationId, leadId: body.leadId, number },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'quotation.created',
        entityType: 'quotation',
        entityId: quotationId,
        actor: userActor(scope),
        metadata: { number, leadId: body.leadId },
      });
      return quotationId;
    });
    return this.get(scope, id);
  }

  async update(
    scope: TenantScope,
    id: string,
    body: UpdateQuotationDto,
  ): Promise<QuotationDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const q = await lockQuotation(tx, scope.tenantId, id);
      if (!quotationIsEditable(q.status)) {
        throw new AppError('QUOTATION_IMMUTABLE', {
          details: { status: q.status, hint: 'create a new revision' },
        });
      }
      const rev = await requireRevision(tx, scope.tenantId, id, q.currentRevisionNo);
      if (rev.status !== 'draft') {
        throw new AppError('QUOTATION_IMMUTABLE', { details: { revisionStatus: rev.status } });
      }

      if (body.customerId !== undefined) {
        if (body.customerId) {
          const c = await loadCustomer(tx, scope.tenantId, body.customerId);
          if (!c) throw new AppError('CUSTOMER_NOT_FOUND');
        }
        await tx
          .update(quotations)
          .set({ customerId: body.customerId, updatedAt: new Date() })
          .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));
      }
      if (body.projectId !== undefined) {
        if (body.projectId) {
          const [p] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, scope.tenantId)));
          if (!p) throw new AppError('PROJECT_NOT_FOUND');
        }
        await tx
          .update(quotations)
          .set({ projectId: body.projectId, updatedAt: new Date() })
          .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));
      }

      await tx
        .update(quotationRevisions)
        .set({
          issueDate: body.issueDate !== undefined ? toDateOrNull(body.issueDate) : undefined,
          validityDate:
            body.validityDate !== undefined ? toDateOrNull(body.validityDate) : undefined,
          notes: body.notes !== undefined ? body.notes : undefined,
          updatedAt: new Date(),
        })
        .where(eq(quotationRevisions.id, rev.id));

      if (body.lines) {
        await this.writeLines(tx, scope, rev.id, body.lines);
      }

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId: id,
        type: 'updated',
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.get(scope, id);
  }

  async revise(
    scope: TenantScope,
    id: string,
    body: ReviseQuotationDto,
  ): Promise<QuotationDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const q = await lockQuotation(tx, scope.tenantId, id);
      if (!quotationCanRevise(q.status)) {
        throw new AppError('QUOTATION_INVALID_TRANSITION', {
          details: { status: q.status, hint: 'only open quotations can be revised' },
        });
      }
      const current = await requireRevision(tx, scope.tenantId, id, q.currentRevisionNo);
      const nextNo = q.currentRevisionNo + 1;

      // freeze the current revision
      await tx
        .update(quotationRevisions)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(eq(quotationRevisions.id, current.id));

      // new editable draft revision — copy header + lines
      const [rev] = await tx
        .insert(quotationRevisions)
        .values({
          tenantId: scope.tenantId,
          quotationId: id,
          revisionNo: nextNo,
          status: 'draft',
          issueDate: current.issueDate,
          validityDate: current.validityDate,
          notes: current.notes,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: quotationRevisions.id });

      const srcLines = await tx
        .select()
        .from(quotationLines)
        .where(
          and(
            eq(quotationLines.tenantId, scope.tenantId),
            eq(quotationLines.revisionId, current.id),
          ),
        )
        .orderBy(asc(quotationLines.lineNo));
      await this.writeLines(
        tx,
        scope,
        rev!.id,
        srcLines.map((l) => ({
          productId: l.productId ?? undefined,
          description: l.description,
          unitLabel: l.unitLabel ?? undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
          taxRate: l.taxRate,
        })),
      );

      await tx
        .update(quotations)
        .set({ currentRevisionNo: nextNo, status: 'DRAFT', updatedAt: new Date() })
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId: id,
        type: 'revised',
        actorMembershipId: scope.actorMembershipId,
        payload: { revisionNo: nextNo, reason: body.reason ?? null },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'quotation.revised',
        payload: { quotationId: id, revisionNo: nextNo },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'quotation.revised',
        entityType: 'quotation',
        entityId: id,
        actor: userActor(scope),
        metadata: { revisionNo: nextNo, reason: body.reason ?? null },
      });
    });
    return this.get(scope, id);
  }

  async send(scope: TenantScope, id: string): Promise<QuotationDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const q = await lockQuotation(tx, scope.tenantId, id);
      if (q.status === 'SENT') return; // idempotent
      if (!isValidQuotationTransition(q.status, 'SENT')) {
        throw new AppError('QUOTATION_INVALID_TRANSITION', {
          details: { from: q.status, to: 'SENT' },
        });
      }
      const rev = await requireRevision(tx, scope.tenantId, id, q.currentRevisionNo);
      const [lineCount] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quotationLines)
        .where(
          and(eq(quotationLines.tenantId, scope.tenantId), eq(quotationLines.revisionId, rev.id)),
        );
      if ((lineCount?.n ?? 0) === 0) throw new AppError('QUOTATION_NO_LINES');

      await tx
        .update(quotationRevisions)
        .set({ status: 'sent', sentAt: sql`now()`, updatedAt: new Date() })
        .where(eq(quotationRevisions.id, rev.id));
      await tx
        .update(quotations)
        .set({ status: 'SENT', updatedAt: new Date() })
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId: id,
        type: 'sent',
        actorMembershipId: scope.actorMembershipId,
        payload: { revisionNo: q.currentRevisionNo },
      });
      await recordLeadActivity(tx, {
        tenantId: scope.tenantId,
        leadId: q.leadId,
        type: 'quotation_sent',
        actorMembershipId: scope.actorMembershipId,
        payload: { quotationId: id, number: q.number },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'quotation.sent',
        payload: { quotationId: id, revisionNo: q.currentRevisionNo },
        actorMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'quotation.sent',
        entityType: 'quotation',
        entityId: id,
        actor: userActor(scope),
        metadata: { number: q.number, revisionNo: q.currentRevisionNo },
        changes: { status: { from: q.status, to: 'SENT' } },
      });
    });
    return this.get(scope, id);
  }

  async accept(
    scope: TenantScope,
    id: string,
    body: AcceptQuotationDto,
  ): Promise<QuotationDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const q = await lockQuotation(tx, scope.tenantId, id);
      if (q.status === 'ACCEPTED') return; // idempotent
      if (!isValidQuotationTransition(q.status, 'ACCEPTED')) {
        throw new AppError('QUOTATION_INVALID_TRANSITION', {
          details: { from: q.status, to: 'ACCEPTED' },
        });
      }
      const rev = await requireRevision(tx, scope.tenantId, id, q.currentRevisionNo);
      if (rev.validityDate && rev.validityDate.getTime() < Date.now()) {
        await tx
          .update(quotations)
          .set({ status: 'EXPIRED', updatedAt: new Date() })
          .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));
        await recordActivity(tx, {
          tenantId: scope.tenantId,
          quotationId: id,
          type: 'expired',
          actorMembershipId: scope.actorMembershipId,
        });
        throw new AppError('QUOTATION_EXPIRED', {
          details: { validityDate: rev.validityDate.toISOString() },
        });
      }

      await tx
        .update(quotationRevisions)
        .set({
          status: 'accepted',
          acceptedAt: sql`now()`,
          acceptedByMembershipId: scope.actorMembershipId,
          acceptanceNote: body.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(quotationRevisions.id, rev.id));
      await tx
        .update(quotations)
        .set({ status: 'ACCEPTED', updatedAt: new Date() })
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId: id,
        type: 'accepted',
        actorMembershipId: scope.actorMembershipId,
        payload: { revisionNo: q.currentRevisionNo, note: body.note ?? null },
      });
      await recordLeadActivity(tx, {
        tenantId: scope.tenantId,
        leadId: q.leadId,
        type: 'quotation_accepted',
        actorMembershipId: scope.actorMembershipId,
        payload: { quotationId: id, number: q.number },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'quotation.accepted',
        payload: { quotationId: id, revisionNo: q.currentRevisionNo },
        actorMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'quotation.accepted',
        entityType: 'quotation',
        entityId: id,
        actor: userActor(scope),
        metadata: { number: q.number, revisionNo: q.currentRevisionNo },
        changes: { status: { from: q.status, to: 'ACCEPTED' } },
      });
    });
    return this.get(scope, id);
  }

  async cancel(scope: TenantScope, id: string): Promise<QuotationDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const q = await lockQuotation(tx, scope.tenantId, id);
      if (q.status === 'CANCELLED') return;
      if (!isValidQuotationTransition(q.status, 'CANCELLED')) {
        throw new AppError('QUOTATION_INVALID_TRANSITION', {
          details: { from: q.status, to: 'CANCELLED' },
        });
      }
      await tx
        .update(quotations)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId: id,
        type: 'cancelled',
        actorMembershipId: scope.actorMembershipId,
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'quotation.cancelled',
        payload: { quotationId: id },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'quotation.cancelled',
        entityType: 'quotation',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: q.status, to: 'CANCELLED' } },
      });
    });
    return this.get(scope, id);
  }

  async expire(scope: TenantScope, id: string): Promise<QuotationDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const q = await lockQuotation(tx, scope.tenantId, id);
      if (q.status === 'EXPIRED') return;
      if (!isValidQuotationTransition(q.status, 'EXPIRED')) {
        throw new AppError('QUOTATION_INVALID_TRANSITION', {
          details: { from: q.status, to: 'EXPIRED' },
        });
      }
      await tx
        .update(quotations)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId: id,
        type: 'expired',
        actorMembershipId: scope.actorMembershipId,
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'quotation.expired',
        payload: { quotationId: id },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'quotation.expired',
        entityType: 'quotation',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: q.status, to: 'EXPIRED' } },
      });
    });
    return this.get(scope, id);
  }

  /**
   * BOOK — the atomic commercial→operational activation (ADR 0035 §16). In one
   * transaction: lock the quotation, promote/link the customer, create or
   * activate the Phase 5 project, link everything, transition the lead to
   * CONVERTED, and emit the events. Concurrent bookings serialize on the
   * `FOR UPDATE` lock; the loser sees `BOOKED` and returns the same result.
   */
  async book(scope: TenantScope, id: string, _body: BookQuotationDto): Promise<BookingResultDto> {
    const result = await withTenantContext(getDb(), scope, async (tx) => {
      const q = await lockQuotation(tx, scope.tenantId, id);

      if (q.status === 'BOOKED') {
        // idempotent — return the already-booked outcome
        return this.bookingResult(tx, scope, id);
      }
      if (q.status !== 'ACCEPTED') {
        throw new AppError('QUOTATION_NOT_ACCEPTED', { details: { status: q.status } });
      }

      const rev = await requireRevision(tx, scope.tenantId, id, q.currentRevisionNo);
      const [lineCount] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quotationLines)
        .where(
          and(eq(quotationLines.tenantId, scope.tenantId), eq(quotationLines.revisionId, rev.id)),
        );
      if ((lineCount?.n ?? 0) === 0) throw new AppError('QUOTATION_NO_LINES');

      // 1. customer — promote the lead if none is linked yet
      const customerId = q.customerId ?? (await promoteLeadTx(tx, this.outbox, scope, q.leadId));
      if (q.customerId) {
        await tx
          .update(customers)
          .set({ status: 'active', updatedAt: new Date() })
          .where(and(eq(customers.id, customerId), eq(customers.tenantId, scope.tenantId)));
      }

      // 2. project — activate the linked one, or create a fresh one from the lead
      const [lead] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, q.leadId), eq(leads.tenantId, scope.tenantId)));
      if (!lead) throw new AppError('LEAD_NOT_FOUND');

      let projectId = q.projectId;
      if (projectId) {
        const [p] = await tx
          .select({ id: projects.id, status: projects.status })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.tenantId, scope.tenantId)))
          .for('update');
        if (!p) throw new AppError('PROJECT_NOT_FOUND');
        if (p.status !== 'DRAFT') {
          throw new AppError('BOOKING_CONFLICT', {
            details: { projectStatus: p.status, hint: 'linked project is already activated' },
          });
        }
      } else {
        const number = `PRJ-${randomUUID().slice(0, 8).toUpperCase()}`;
        try {
          const [pRow] = await tx
            .insert(projects)
            .values({
              tenantId: scope.tenantId,
              leadId: q.leadId,
              number,
              customerName: lead.name ?? null,
              status: 'DRAFT',
              siteAddressLine: lead.addressLine,
              siteCity: lead.city,
              siteState: lead.state,
              sitePostalCode: lead.postalCode,
              siteCountry: lead.country,
              createdByMembershipId: scope.actorMembershipId,
            })
            .returning({ id: projects.id });
          projectId = pRow!.id;
        } catch (err) {
          if (isUniqueViolation(err))
            throw new AppError('BOOKING_CONFLICT', { details: { number } });
          throw err;
        }
        await tx.insert(projectActivities).values({
          tenantId: scope.tenantId,
          projectId,
          type: 'created',
          actorMembershipId: scope.actorMembershipId,
          payload: { number, leadId: q.leadId, quotationId: id },
        });
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'project.created',
          payload: { projectId, leadId: q.leadId, number },
        });
      }

      // 3. operational activation — project -> APPROVED
      await tx
        .update(projects)
        .set({
          status: 'APPROVED',
          approvedAt: sql`now()`,
          approvedByMembershipId: scope.actorMembershipId,
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, projectId), eq(projects.tenantId, scope.tenantId)));
      await tx.insert(projectActivities).values([
        {
          tenantId: scope.tenantId,
          projectId,
          type: 'approved' as const,
          actorMembershipId: scope.actorMembershipId,
          payload: { via: 'quotation_booking', quotationId: id },
        },
        {
          tenantId: scope.tenantId,
          projectId,
          type: 'booked' as const,
          actorMembershipId: scope.actorMembershipId,
          payload: { quotationId: id, quotationNumber: q.number, customerId },
        },
      ]);

      // 4. quotation -> BOOKED, fully linked
      await tx
        .update(quotations)
        .set({
          status: 'BOOKED',
          customerId,
          projectId,
          bookedAt: sql`now()`,
          bookedByMembershipId: scope.actorMembershipId,
          updatedAt: new Date(),
        })
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));

      // 5. lead -> CONVERTED + timeline. Booking a quotation *is* the
      //    conversion, so the lead is moved unless it is already CONVERTED
      //    (the CRM lifecycle's QUALIFIED->CONVERTED edge is the happy path;
      //    booking from an earlier open status is still a real conversion).
      if (lead.status !== 'CONVERTED') {
        await tx
          .update(leads)
          .set({ status: 'CONVERTED', updatedAt: new Date() })
          .where(and(eq(leads.id, q.leadId), eq(leads.tenantId, scope.tenantId)));
        await recordLeadActivity(tx, {
          tenantId: scope.tenantId,
          leadId: q.leadId,
          type: 'status_changed',
          actorMembershipId: scope.actorMembershipId,
          payload: {
            from: lead.status,
            to: 'CONVERTED',
            via: 'quotation_booking',
            direct: !isValidLeadTransition(lead.status, 'CONVERTED'),
          },
        });
      }
      await recordLeadActivity(tx, {
        tenantId: scope.tenantId,
        leadId: q.leadId,
        type: 'quotation_booked',
        actorMembershipId: scope.actorMembershipId,
        payload: { quotationId: id, number: q.number, projectId, customerId },
      });

      // 6. quotation timeline + events
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        quotationId: id,
        type: 'booked',
        actorMembershipId: scope.actorMembershipId,
        payload: { projectId, customerId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'quotation.booked',
        payload: { quotationId: id, projectId, customerId },
        actorMembershipId: scope.actorMembershipId,
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'project.booked',
        payload: { projectId, quotationId: id, customerId, leadId: q.leadId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'project.approved',
        payload: { projectId, via: 'quotation_booking' },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'quotation.booked',
        entityType: 'quotation',
        entityId: id,
        actor: userActor(scope),
        metadata: { number: q.number, projectId, customerId },
        changes: { status: { from: q.status, to: 'BOOKED' } },
      });

      return this.bookingResult(tx, scope, id);
    });
    return result;
  }

  // ---- attachments (existing object storage) --------------------

  async listAttachments(scope: TenantScope, id: string): Promise<QuotationAttachmentDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      if (!(await quotationExists(tx, scope.tenantId, id)))
        throw new AppError('QUOTATION_NOT_FOUND');
      const rows = await tx
        .select()
        .from(quotationAttachments)
        .where(
          and(
            eq(quotationAttachments.tenantId, scope.tenantId),
            eq(quotationAttachments.quotationId, id),
          ),
        )
        .orderBy(desc(quotationAttachments.createdAt));
      return rows.map(toAttachmentDto);
    });
  }

  async uploadAttachment(
    scope: TenantScope,
    id: string,
    file: { buffer: Buffer; originalFilename: string; contentType: string; size: number },
  ): Promise<QuotationAttachmentDto> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'too_large' } });
    }
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.contentType)) {
      throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'unsupported_type' } });
    }
    const key = buildEntityAttachmentKey(scope.tenantId, 'quotations', id, file.originalFilename);
    await this.storage.putObject({
      key,
      body: file.buffer,
      contentType: file.contentType,
    });
    return withTenantContext(getDb(), scope, async (tx) => {
      if (!(await quotationExists(tx, scope.tenantId, id))) {
        await this.storage.deleteObject(key);
        throw new AppError('QUOTATION_NOT_FOUND');
      }
      const [row] = await tx
        .insert(quotationAttachments)
        .values({
          tenantId: scope.tenantId,
          quotationId: id,
          objectKey: key,
          originalFilename: file.originalFilename,
          contentType: file.contentType,
          fileSize: file.size,
          uploadedByMembershipId: scope.actorMembershipId,
        })
        .returning();
      return toAttachmentDto(row!);
    });
  }

  async downloadAttachment(
    scope: TenantScope,
    id: string,
    attachmentId: string,
  ): Promise<{ body: Buffer; contentType: string; originalFilename: string | null }> {
    const meta = await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(quotationAttachments)
        .where(
          and(
            eq(quotationAttachments.id, attachmentId),
            eq(quotationAttachments.quotationId, id),
            eq(quotationAttachments.tenantId, scope.tenantId),
          ),
        );
      if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');
      return row;
    });
    const object = await this.storage.getObject(meta.objectKey);
    if (!object) throw new AppError('ATTACHMENT_NOT_FOUND');
    return {
      body: object.body,
      contentType: meta.contentType,
      originalFilename: meta.originalFilename,
    };
  }

  async deleteAttachment(scope: TenantScope, id: string, attachmentId: string): Promise<void> {
    const key = await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(quotationAttachments)
        .where(
          and(
            eq(quotationAttachments.id, attachmentId),
            eq(quotationAttachments.quotationId, id),
            eq(quotationAttachments.tenantId, scope.tenantId),
          ),
        );
      if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');
      await tx
        .delete(quotationAttachments)
        .where(
          and(
            eq(quotationAttachments.id, attachmentId),
            eq(quotationAttachments.tenantId, scope.tenantId),
          ),
        );
      return row.objectKey;
    });
    await this.storage.deleteObject(key);
  }

  // ---- internals -----------------------------------------------

  private async writeLines(
    tx: Tx,
    scope: TenantScope,
    revisionId: string,
    input: QuotationLineInputDto[],
  ): Promise<void> {
    await tx
      .delete(quotationLines)
      .where(
        and(eq(quotationLines.tenantId, scope.tenantId), eq(quotationLines.revisionId, revisionId)),
      );

    const normalized: (QuoteLineInput & {
      productId: string | null;
      description: string;
      unitLabel: string | null;
    })[] = [];
    for (const [i, raw] of input.entries()) {
      let productId: string | null = null;
      const unitLabel = raw.unitLabel ?? null;
      let description = raw.description?.trim() ?? '';
      if (raw.productId) {
        const [product] = await tx
          .select({ id: products.id, name: products.name, sku: products.sku })
          .from(products)
          .where(and(eq(products.id, raw.productId), eq(products.tenantId, scope.tenantId)));
        if (!product) throw new AppError('PRODUCT_NOT_FOUND', { details: { line: i + 1 } });
        productId = product.id;
        if (!description) description = product.name;
      }
      if (!description) {
        throw new AppError('VALIDATION_ERROR', {
          details: { line: i + 1, field: 'description' },
        });
      }
      normalized.push({
        productId,
        description,
        unitLabel,
        quantity: raw.quantity,
        unitPrice: raw.unitPrice,
        discount: raw.discount ?? '0',
        taxRate: raw.taxRate ?? '0',
      });
    }

    if (normalized.length > 0) {
      await tx.insert(quotationLines).values(
        normalized.map((l, idx) => {
          const amounts = lineAmounts(l);
          return {
            tenantId: scope.tenantId,
            revisionId,
            lineNo: idx + 1,
            productId: l.productId,
            description: l.description,
            unitLabel: l.unitLabel,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount,
            taxRate: l.taxRate,
            lineNet: amounts.lineNet,
            lineTax: amounts.lineTax,
            lineTotal: amounts.lineTotal,
          };
        }),
      );
    }

    const totals = quoteTotals(normalized);
    await tx
      .update(quotationRevisions)
      .set({
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        updatedAt: new Date(),
      })
      .where(eq(quotationRevisions.id, revisionId));
  }

  private async loadDetail(tx: Tx, scope: TenantScope, id: string): Promise<QuotationDetailDto> {
    const [row] = await tx
      .select({
        q: quotations,
        leadName: leads.name,
        customerName: customers.name,
        projectNumber: projects.number,
      })
      .from(quotations)
      .leftJoin(leads, eq(leads.id, quotations.leadId))
      .leftJoin(customers, eq(customers.id, quotations.customerId))
      .leftJoin(projects, eq(projects.id, quotations.projectId))
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));
    if (!row) throw new AppError('QUOTATION_NOT_FOUND');

    const revRows = await tx
      .select({ r: quotationRevisions, acceptedByName: users.name })
      .from(quotationRevisions)
      .leftJoin(
        userTenantMemberships,
        eq(userTenantMemberships.id, quotationRevisions.acceptedByMembershipId),
      )
      .leftJoin(users, eq(users.id, userTenantMemberships.userId))
      .where(
        and(
          eq(quotationRevisions.tenantId, scope.tenantId),
          eq(quotationRevisions.quotationId, id),
        ),
      )
      .orderBy(desc(quotationRevisions.revisionNo));

    const revisionIds = revRows.map((r) => r.r.id);
    const lineRows = revisionIds.length
      ? await tx
          .select({ l: quotationLines, sku: products.sku })
          .from(quotationLines)
          .leftJoin(products, eq(products.id, quotationLines.productId))
          .where(
            and(
              eq(quotationLines.tenantId, scope.tenantId),
              inArray(quotationLines.revisionId, revisionIds),
            ),
          )
          .orderBy(asc(quotationLines.lineNo))
      : [];

    const linesByRevision = new Map<string, QuotationLineDto[]>();
    for (const lr of lineRows) {
      const arr = linesByRevision.get(lr.l.revisionId) ?? [];
      arr.push(toLineDto(lr.l, lr.sku));
      linesByRevision.set(lr.l.revisionId, arr);
    }

    const revisions: QuotationRevisionDto[] = revRows.map((r) =>
      toRevisionDto(r.r, r.acceptedByName, linesByRevision.get(r.r.id) ?? []),
    );
    const currentRevision =
      revisions.find((r) => r.revisionNo === row.q.currentRevisionNo) ?? revisions[0]!;

    return {
      ...toQuotationDto(row.q, row.leadName, row.customerName, row.projectNumber),
      validityDate: currentRevision.validityDate,
      total: currentRevision.total,
      currentRevision,
      revisions,
    };
  }

  private async bookingResult(tx: Tx, scope: TenantScope, id: string): Promise<BookingResultDto> {
    const [row] = await tx
      .select({
        q: quotations,
        leadName: leads.name,
        customerName: customers.name,
        projectNumber: projects.number,
      })
      .from(quotations)
      .leftJoin(leads, eq(leads.id, quotations.leadId))
      .leftJoin(customers, eq(customers.id, quotations.customerId))
      .leftJoin(projects, eq(projects.id, quotations.projectId))
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, scope.tenantId)));
    if (!row || !row.q.projectId || !row.q.customerId) {
      throw new AppError('BOOKING_CONFLICT', { details: { hint: 'booking incomplete' } });
    }
    return {
      quotation: toQuotationDto(row.q, row.leadName, row.customerName, row.projectNumber),
      projectId: row.q.projectId,
      projectNumber: row.projectNumber ?? '',
      customerId: row.q.customerId,
    };
  }
}

// ---- helpers ---------------------------------------------------

async function recordActivity(
  tx: Tx,
  input: {
    tenantId: string;
    quotationId: string;
    type: QuotationActivityKind;
    actorMembershipId: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(quotationActivities).values({
    tenantId: input.tenantId,
    quotationId: input.quotationId,
    type: input.type,
    actorMembershipId: input.actorMembershipId,
    payload: input.payload ?? {},
  });
}

async function recordLeadActivity(
  tx: Tx,
  input: {
    tenantId: string;
    leadId: string;
    type: LeadActivityKind;
    actorMembershipId: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(leadActivities).values({
    tenantId: input.tenantId,
    leadId: input.leadId,
    type: input.type,
    actorMembershipId: input.actorMembershipId,
    payload: input.payload ?? {},
  });
}

async function quotationExists(tx: Tx, tenantId: string, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: quotations.id })
    .from(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
  return !!row;
}

async function lockQuotation(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<typeof quotations.$inferSelect> {
  const [row] = await tx
    .select()
    .from(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)))
    .for('update');
  if (!row) throw new AppError('QUOTATION_NOT_FOUND');
  return row;
}

async function requireRevision(
  tx: Tx,
  tenantId: string,
  quotationId: string,
  revisionNo: number,
): Promise<typeof quotationRevisions.$inferSelect> {
  const [row] = await tx
    .select()
    .from(quotationRevisions)
    .where(
      and(
        eq(quotationRevisions.tenantId, tenantId),
        eq(quotationRevisions.quotationId, quotationId),
        eq(quotationRevisions.revisionNo, revisionNo),
      ),
    );
  if (!row) throw new AppError('QUOTATION_NOT_FOUND', { details: { revisionNo } });
  return row;
}

function toDateOrNull(iso: string | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

function toQuotationDto(
  q: typeof quotations.$inferSelect,
  leadName: string | null,
  customerName: string | null,
  projectNumber: string | null,
): QuotationDto {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    currentRevisionNo: q.currentRevisionNo,
    leadId: q.leadId,
    leadName,
    customerId: q.customerId,
    customerName,
    projectId: q.projectId,
    projectNumber,
    validityDate: null,
    total: '0.00',
    bookedAt: q.bookedAt ? q.bookedAt.toISOString() : null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

function toRevisionDto(
  r: typeof quotationRevisions.$inferSelect,
  acceptedByName: string | null,
  lines: QuotationLineDto[],
): QuotationRevisionDto {
  return {
    id: r.id,
    revisionNo: r.revisionNo,
    status: r.status,
    issueDate: r.issueDate ? r.issueDate.toISOString() : null,
    validityDate: r.validityDate ? r.validityDate.toISOString() : null,
    notes: r.notes,
    subtotal: r.subtotal,
    discountTotal: r.discountTotal,
    taxTotal: r.taxTotal,
    total: r.total,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
    acceptedByName,
    acceptanceNote: r.acceptanceNote,
    createdAt: r.createdAt.toISOString(),
    lines,
  };
}

function toLineDto(l: typeof quotationLines.$inferSelect, sku: string | null): QuotationLineDto {
  return {
    id: l.id,
    lineNo: l.lineNo,
    productId: l.productId,
    productSku: sku,
    description: l.description,
    unitLabel: l.unitLabel,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount,
    taxRate: l.taxRate,
    lineNet: l.lineNet,
    lineTax: l.lineTax,
    lineTotal: l.lineTotal,
  };
}

function toAttachmentDto(row: typeof quotationAttachments.$inferSelect): QuotationAttachmentDto {
  return {
    id: row.id,
    quotationId: row.quotationId,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    fileSize: row.fileSize,
    createdAt: row.createdAt.toISOString(),
  };
}
