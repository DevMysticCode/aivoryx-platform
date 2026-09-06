import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { TenantScope } from '../supply/common.js';
import { pageBounds } from '../supply/common.js';
import {
  DEFAULT_RULES,
  DEFAULT_TEMPLATES,
  defaultRule,
  defaultTemplate,
  effectiveRules,
  mergeTemplate,
  type NotificationChannel,
  type TenantRuleOverride,
  type TenantTemplateOverride,
} from './catalogue.js';
import type {
  NotificationDeliveryListDto,
  NotificationRuleDto,
  NotificationTemplateDto,
} from './notifications.dto.js';

const { notificationRules, notificationTemplates, notificationDeliveries, notifications } = schema;

const TEMPLATE_CHANNELS: NotificationChannel[] = ['in_app', 'email'];

/**
 * Tenant notification configuration (ADR 0037). The catalogue of rules and
 * templates lives in code; this service exposes the *effective* view (default
 * merged with any tenant override) and lets a tenant admin toggle a rule,
 * narrow its channels, re-word a template, or reset a template to the default.
 * It is deliberately not a workflow builder.
 */
@Injectable()
export class NotificationsAdminService {
  async listRules(scope: TenantScope): Promise<NotificationRuleDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const overrides = await this.loadRuleOverrides(tx, scope.tenantId);
      return effectiveRules(overrides).map((rule) => {
        const base = defaultRule(rule.key)!;
        return {
          key: rule.key,
          eventType: rule.eventType,
          templateKey: rule.templateKey,
          channels: rule.channels,
          availableChannels: base.channels,
          recipientStrategy: rule.recipientStrategy,
          notificationType: rule.notificationType,
          suppressible: rule.suppressible,
          isActive: rule.isActive,
          overridden: rule.overridden,
          description: rule.description,
        };
      });
    });
  }

  async setRule(
    scope: TenantScope,
    key: string,
    patch: { isActive?: boolean; channels?: string[] },
  ): Promise<NotificationRuleDto[]> {
    const base = defaultRule(key);
    if (!base) throw new AppError('NOTIFICATION_RULE_NOT_FOUND', { details: { key } });

    const channels =
      patch.channels === undefined
        ? undefined
        : (patch.channels.filter((c): c is NotificationChannel =>
            base.channels.includes(c as NotificationChannel),
          ) as NotificationChannel[]);

    await withTenantContext(getDb(), scope, async (tx) => {
      await tx
        .insert(notificationRules)
        .values({
          tenantId: scope.tenantId,
          key,
          eventType: base.eventType,
          isActive: patch.isActive ?? true,
          channels: channels ?? null,
          updatedByMembershipId: scope.actorMembershipId,
        })
        .onConflictDoUpdate({
          target: [notificationRules.tenantId, notificationRules.key],
          set: {
            ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
            ...(channels === undefined ? {} : { channels }),
            updatedByMembershipId: scope.actorMembershipId,
            updatedAt: new Date(),
          },
        });
    });
    return this.listRules(scope);
  }

  async listTemplates(scope: TenantScope): Promise<NotificationTemplateDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const overrides = await this.loadTemplateOverrides(tx, scope.tenantId);
      return DEFAULT_TEMPLATES.map((base) => this.projectTemplate(base.key, overrides));
    });
  }

  async getTemplate(scope: TenantScope, key: string): Promise<NotificationTemplateDto> {
    if (!defaultTemplate(key)) {
      throw new AppError('NOTIFICATION_TEMPLATE_NOT_FOUND', { details: { key } });
    }
    return withTenantContext(getDb(), scope, async (tx) => {
      const overrides = await this.loadTemplateOverrides(tx, scope.tenantId);
      return this.projectTemplate(key, overrides);
    });
  }

  async updateTemplate(
    scope: TenantScope,
    key: string,
    input: { title: string; body: string; emailSubject: string; emailBody: string },
  ): Promise<NotificationTemplateDto> {
    if (!defaultTemplate(key)) {
      throw new AppError('NOTIFICATION_TEMPLATE_NOT_FOUND', { details: { key } });
    }
    await withTenantContext(getDb(), scope, async (tx) => {
      for (const channel of TEMPLATE_CHANNELS) {
        await tx
          .insert(notificationTemplates)
          .values({
            tenantId: scope.tenantId,
            key,
            channel,
            title: input.title,
            body: input.body,
            emailSubject: channel === 'email' ? input.emailSubject : null,
            emailBody: channel === 'email' ? input.emailBody : null,
            isActive: true,
            updatedByMembershipId: scope.actorMembershipId,
          })
          .onConflictDoUpdate({
            target: [
              notificationTemplates.tenantId,
              notificationTemplates.key,
              notificationTemplates.channel,
            ],
            set: {
              title: input.title,
              body: input.body,
              emailSubject: channel === 'email' ? input.emailSubject : null,
              emailBody: channel === 'email' ? input.emailBody : null,
              isActive: true,
              updatedByMembershipId: scope.actorMembershipId,
              updatedAt: new Date(),
            },
          });
      }
    });
    return this.getTemplate(scope, key);
  }

  async resetTemplate(scope: TenantScope, key: string): Promise<NotificationTemplateDto> {
    if (!defaultTemplate(key)) {
      throw new AppError('NOTIFICATION_TEMPLATE_NOT_FOUND', { details: { key } });
    }
    await withTenantContext(getDb(), scope, async (tx) => {
      await tx
        .delete(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.tenantId, scope.tenantId),
            eq(notificationTemplates.key, key),
          ),
        );
    });
    return this.getTemplate(scope, key);
  }

  async listDeliveries(
    scope: TenantScope,
    query: { page?: number; pageSize?: number; status?: string },
  ): Promise<NotificationDeliveryListDto> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(notificationDeliveries.tenantId, scope.tenantId)];
      if (query.status) {
        conds.push(eq(notificationDeliveries.status, query.status as 'pending'));
      }
      const where = and(...conds);

      const [totalRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(notificationDeliveries)
        .where(where);

      const rows = await tx
        .select({
          d: notificationDeliveries,
          title: notifications.title,
          type: notifications.type,
          sourceEventType: notifications.sourceEventType,
          ruleKey: notifications.ruleKey,
        })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
        .where(where)
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        items: rows.map((r) => ({
          id: r.d.id,
          notificationId: r.d.notificationId,
          title: r.title,
          type: r.type,
          sourceEventType: r.sourceEventType,
          ruleKey: r.ruleKey,
          channel: r.d.channel,
          recipientRef: maskRecipient(r.d.recipientRef),
          provider: r.d.provider,
          status: r.d.status,
          attempts: r.d.attempts,
          maxAttempts: r.d.maxAttempts,
          failureCode: r.d.failureCode,
          failureMessage: r.d.failureMessage,
          providerMessageId: r.d.providerMessageId,
          lastAttemptAt: r.d.lastAttemptAt ? r.d.lastAttemptAt.toISOString() : null,
          sentAt: r.d.sentAt ? r.d.sentAt.toISOString() : null,
          createdAt: r.d.createdAt.toISOString(),
        })),
        total: totalRow?.total ?? 0,
        page,
        pageSize,
      };
    });
  }

  // --- helpers ---------------------------------------------------

  private projectTemplate(
    key: string,
    overrides: Map<string, TenantTemplateOverride>,
  ): NotificationTemplateDto {
    const base = defaultTemplate(key)!;
    let anyOverridden = false;
    const channels = TEMPLATE_CHANNELS.map((channel) => {
      const merged = mergeTemplate(key, channel, overrides.get(`${key}:${channel}`))!;
      anyOverridden = anyOverridden || merged.overridden;
      return {
        channel,
        title: merged.title,
        body: merged.body,
        emailSubject: channel === 'email' ? merged.emailSubject : null,
        emailBody: channel === 'email' ? merged.emailBody : null,
        overridden: merged.overridden,
      };
    });
    return { key, variables: base.requiredVars, channels, overridden: anyOverridden };
  }

  private async loadRuleOverrides(tx: Tx, tenantId: string): Promise<TenantRuleOverride[]> {
    const rows = await tx
      .select({
        key: notificationRules.key,
        isActive: notificationRules.isActive,
        channels: notificationRules.channels,
      })
      .from(notificationRules)
      .where(eq(notificationRules.tenantId, tenantId));
    return rows.map((r) => ({ key: r.key, isActive: r.isActive, channels: r.channels ?? null }));
  }

  private async loadTemplateOverrides(
    tx: Tx,
    tenantId: string,
  ): Promise<Map<string, TenantTemplateOverride>> {
    const rows = await tx
      .select({
        key: notificationTemplates.key,
        channel: notificationTemplates.channel,
        title: notificationTemplates.title,
        body: notificationTemplates.body,
        emailSubject: notificationTemplates.emailSubject,
        emailBody: notificationTemplates.emailBody,
        isActive: notificationTemplates.isActive,
      })
      .from(notificationTemplates)
      .where(eq(notificationTemplates.tenantId, tenantId));
    const map = new Map<string, TenantTemplateOverride>();
    for (const r of rows) {
      map.set(`${r.key}:${r.channel}`, {
        key: r.key,
        channel: r.channel,
        title: r.title,
        body: r.body,
        emailSubject: r.emailSubject,
        emailBody: r.emailBody,
        isActive: r.isActive,
      });
    }
    return map;
  }
}

/** Show only enough of an internal recipient ref to be useful in an admin list. */
function maskRecipient(ref: string): string {
  if (ref.includes('@')) {
    const [local, domain] = ref.split('@');
    return `${local!.slice(0, 2)}***@${domain}`;
  }
  return `${ref.slice(0, 8)}…`;
}

export { DEFAULT_RULES };
