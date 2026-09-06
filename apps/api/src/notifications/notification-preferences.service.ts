import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AuditService, userActor } from '../audit/audit.service.js';
import type { TenantScope } from '../supply/common.js';
import type { NotificationChannel } from './catalogue.js';

const { notificationPreferences } = schema;

export interface ResolvedPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

const DEFAULT_PREFERENCES: ResolvedPreferences = { inAppEnabled: true, emailEnabled: true };

/**
 * Per-membership channel opt-outs (ADR 0037). Absence of a row means every
 * channel is enabled. Evaluated before each delivery; a rule marked
 * non-suppressible ignores these.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly audit: AuditService) {}

  /** Worker-side: read within an existing tenant transaction. */
  async resolve(tx: Tx, tenantId: string, membershipId: string): Promise<ResolvedPreferences> {
    const [row] = await tx
      .select({
        inAppEnabled: notificationPreferences.inAppEnabled,
        emailEnabled: notificationPreferences.emailEnabled,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.membershipId, membershipId),
        ),
      )
      .limit(1);
    return row ?? DEFAULT_PREFERENCES;
  }

  channelAllowed(prefs: ResolvedPreferences, channel: NotificationChannel): boolean {
    if (channel === 'in_app') return prefs.inAppEnabled;
    if (channel === 'email') return prefs.emailEnabled;
    // whatsapp / sms have no preference toggle yet — allowed (the adapter still
    // controls availability).
    return true;
  }

  /** Controller-side: the caller's own preferences. */
  async get(scope: TenantScope): Promise<ResolvedPreferences> {
    return withTenantContext(getDb(), scope, (tx) =>
      this.resolve(tx, scope.tenantId, scope.actorMembershipId),
    );
  }

  async update(
    scope: TenantScope,
    input: { inAppEnabled: boolean; emailEnabled: boolean },
  ): Promise<ResolvedPreferences> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await tx
        .insert(notificationPreferences)
        .values({
          tenantId: scope.tenantId,
          membershipId: scope.actorMembershipId,
          inAppEnabled: input.inAppEnabled,
          emailEnabled: input.emailEnabled,
        })
        .onConflictDoUpdate({
          target: [notificationPreferences.tenantId, notificationPreferences.membershipId],
          set: {
            inAppEnabled: input.inAppEnabled,
            emailEnabled: input.emailEnabled,
            updatedAt: new Date(),
          },
        });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'notification.preference.updated',
        entityType: 'notification_preference',
        entityId: scope.actorMembershipId,
        actor: userActor(scope),
        metadata: { inAppEnabled: input.inAppEnabled, emailEnabled: input.emailEnabled },
      });
      return this.resolve(tx, scope.tenantId, scope.actorMembershipId);
    });
  }
}
