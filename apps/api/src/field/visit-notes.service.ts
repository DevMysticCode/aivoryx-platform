import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { recordVisitActivity } from './visit-activities.js';
import type { TenantScope, VisitVisibility } from './visits.service.js';
import { VisitsService } from './visits.service.js';

const { visitNotes, users, userTenantMemberships } = schema;

export interface VisitNoteView {
  id: string;
  visitId: string;
  authorMembershipId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/** Visit-scoped notes (Phase 4, ADR 0033) — structurally mirrors `lead_notes`
 *  but lives on its own table since one lead can have several visits. */
@Injectable()
export class VisitNotesService {
  constructor(private readonly visits: VisitsService) {}

  async list(
    scope: TenantScope,
    visitId: string,
    visibility: VisitVisibility,
  ): Promise<VisitNoteView[]> {
    await this.visits.get(scope, visitId, visibility);
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: visitNotes.id,
          visitId: visitNotes.visitId,
          authorMembershipId: visitNotes.authorMembershipId,
          authorName: users.name,
          body: visitNotes.body,
          createdAt: visitNotes.createdAt,
        })
        .from(visitNotes)
        .leftJoin(
          userTenantMemberships,
          eq(userTenantMemberships.id, visitNotes.authorMembershipId),
        )
        .leftJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(and(eq(visitNotes.tenantId, scope.tenantId), eq(visitNotes.visitId, visitId)))
        .orderBy(desc(visitNotes.createdAt));
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
  }

  async create(
    scope: TenantScope,
    visitId: string,
    body: string,
    visibility: VisitVisibility,
  ): Promise<VisitNoteView> {
    await this.visits.get(scope, visitId, visibility);
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .insert(visitNotes)
        .values({
          tenantId: scope.tenantId,
          visitId,
          authorMembershipId: scope.actorMembershipId,
          body,
        })
        .returning();
      if (!row) throw new AppError('INTERNAL_ERROR');

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'note',
        actorMembershipId: scope.actorMembershipId,
        payload: { noteId: row.id },
      });

      return {
        id: row.id,
        visitId: row.visitId,
        authorMembershipId: row.authorMembershipId,
        authorName: null,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
