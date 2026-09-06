import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { TenantScope } from '../supply/common.js';
import { pageBounds } from '../supply/common.js';
import type { NotificationDto, NotificationListDto } from './notifications.dto.js';

const { notifications } = schema;

/**
 * The signed-in user's own notifications (ADR 0037). Every query is hard-scoped
 * to `recipient_membership_id = <caller's membership>` in addition to RLS —
 * a user can only ever see or mutate their own notifications.
 */
@Injectable()
export class NotificationsUserService {
  async list(
    scope: TenantScope,
    query: { page?: number; pageSize?: number; unreadOnly?: boolean },
  ): Promise<NotificationListDto> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const mine = eq(notifications.recipientMembershipId, scope.actorMembershipId);
      const where = query.unreadOnly ? and(mine, isNull(notifications.readAt)) : mine;

      const [totalRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(notifications)
        .where(where);
      const [unreadRow] = await tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(mine, isNull(notifications.readAt)));

      const rows = await tx
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        items: rows.map(toDto),
        total: totalRow?.total ?? 0,
        unread: unreadRow?.unread ?? 0,
        page,
        pageSize,
      };
    });
  }

  async unreadCount(scope: TenantScope): Promise<number> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientMembershipId, scope.actorMembershipId),
            isNull(notifications.readAt),
          ),
        );
      return row?.unread ?? 0;
    });
  }

  async markRead(scope: TenantScope, id: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const result = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.recipientMembershipId, scope.actorMembershipId),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id });
      if (result.length === 0) {
        // either it does not exist, is not ours, or is already read — only the
        // first two are errors; a re-mark is a harmless no-op.
        const [exists] = await tx
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.id, id),
              eq(notifications.recipientMembershipId, scope.actorMembershipId),
            ),
          )
          .limit(1);
        if (!exists) throw new AppError('NOTIFICATION_NOT_FOUND');
      }
    });
  }

  async markAllRead(scope: TenantScope): Promise<number> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const result = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.recipientMembershipId, scope.actorMembershipId),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id });
      return result.length;
    });
  }
}

function toDto(row: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    deepLink: row.deepLink,
    sourceEventType: row.sourceEventType,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}
