import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { recordActivity } from './activities.js';

const { leadNotes, leads } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
  /** true for a caller who may edit/delete anyone's note (holds `crm.leads.update`) */
  canManageAnyNote: boolean;
}

export interface NoteView {
  id: string;
  leadId: string;
  authorMembershipId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class NotesService {
  async create(scope: TenantScope, leadId: string, body: string): Promise<NoteView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await requireLead(tx, scope.tenantId, leadId);
      const [row] = await tx
        .insert(leadNotes)
        .values({
          tenantId: scope.tenantId,
          leadId,
          authorMembershipId: scope.actorMembershipId,
          body,
        })
        .returning();
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId,
        type: 'note',
        actorMembershipId: scope.actorMembershipId,
        payload: { noteId: row!.id },
      });
      return toView(row!);
    });
  }

  list(scope: TenantScope, leadId: string): Promise<NoteView[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(leadNotes)
        .where(
          and(
            eq(leadNotes.tenantId, scope.tenantId),
            eq(leadNotes.leadId, leadId),
            isNull(leadNotes.deletedAt),
          ),
        )
        .orderBy(leadNotes.createdAt);
      return rows.map(toView);
    });
  }

  async update(
    scope: TenantScope,
    leadId: string,
    noteId: string,
    body: string,
  ): Promise<NoteView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const note = await requireNote(tx, scope.tenantId, leadId, noteId);
      assertCanManage(scope, note.authorMembershipId);
      const [row] = await tx
        .update(leadNotes)
        .set({ body, updatedAt: new Date() })
        .where(eq(leadNotes.id, noteId))
        .returning();
      return toView(row!);
    });
  }

  async remove(scope: TenantScope, leadId: string, noteId: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const note = await requireNote(tx, scope.tenantId, leadId, noteId);
      assertCanManage(scope, note.authorMembershipId);
      await tx.update(leadNotes).set({ deletedAt: new Date() }).where(eq(leadNotes.id, noteId));
    });
  }
}

function assertCanManage(scope: TenantScope, authorMembershipId: string | null): void {
  if (scope.canManageAnyNote) return;
  if (authorMembershipId === scope.actorMembershipId) return;
  throw new AppError('NOTE_FORBIDDEN');
}

async function requireLead(tx: Tx, tenantId: string, leadId: string): Promise<void> {
  const [row] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError('LEAD_NOT_FOUND');
}

async function requireNote(
  tx: Tx,
  tenantId: string,
  leadId: string,
  noteId: string,
): Promise<{ authorMembershipId: string | null }> {
  const [row] = await tx
    .select({ authorMembershipId: leadNotes.authorMembershipId })
    .from(leadNotes)
    .where(
      and(
        eq(leadNotes.id, noteId),
        eq(leadNotes.leadId, leadId),
        eq(leadNotes.tenantId, tenantId),
        isNull(leadNotes.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('NOTE_NOT_FOUND');
  return row;
}

function toView(row: typeof leadNotes.$inferSelect): NoteView {
  return {
    id: row.id,
    leadId: row.leadId,
    authorMembershipId: row.authorMembershipId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
