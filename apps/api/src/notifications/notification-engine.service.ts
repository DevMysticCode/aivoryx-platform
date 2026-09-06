import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { getDb, schema, withTenantSystemContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import {
  type EffectiveRule,
  effectiveRulesForEvent,
  HANDLED_EVENT_TYPES,
  mergeTemplate,
  type NotificationChannel,
  type TenantRuleOverride,
  type TenantTemplateOverride,
} from './catalogue.js';
import { renderRequired, renderTemplate } from './template.js';
import { buildEventContext } from './event-context.js';
import { RecipientResolver, type ResolvedRecipient } from './recipient-resolver.js';
import { deliveryIdempotencyKey, notificationDedupeKey } from './idempotency.js';
import { NOTIFICATIONS_QUEUE } from './notifications.queue.js';

const { notificationRules, notificationTemplates, notifications, notificationDeliveries } = schema;

interface HandledEvent {
  id: string;
  type: string;
  tenantId: string;
  payload: Record<string, unknown>;
  actorMembershipId: string | null;
}

/**
 * The Notification Engine (ADR 0037): one committed business/outbox event ->
 * matching rules -> recipient resolution -> template render -> a `notifications`
 * row + one `notification_deliveries` row per channel -> a queued `deliver`
 * job. Everything is idempotent: the dedupe/idempotency keys + unique
 * constraints mean a replayed or re-processed event produces no duplicates.
 *
 * Runs entirely inside the event's own tenant RLS context
 * (`withTenantSystemContext`) — the payload never supplies tenant ownership.
 */
@Injectable()
export class NotificationEngineService {
  private readonly logger = new Logger('NotificationEngine');

  constructor(
    private readonly resolver: RecipientResolver,
    @Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue | null,
  ) {}

  async handleEvent(event: HandledEvent): Promise<{ created: number }> {
    if (!HANDLED_EVENT_TYPES.has(event.type)) return { created: 0 };

    const enqueue: { deliveryId: string; tenantId: string }[] = await withTenantSystemContext(
      getDb(),
      event.tenantId,
      async (tx) => {
        const ruleOverrides = await this.loadRuleOverrides(tx, event.tenantId);
        const rules = effectiveRulesForEvent(event.type, ruleOverrides).filter((r) => r.isActive);
        if (rules.length === 0) return [];

        const built = await buildEventContext(tx, event);
        if (!built) {
          this.logger.warn(`no context builder produced output for ${event.type} (${event.id})`);
          return [];
        }

        const templateOverrides = await this.loadTemplateOverrides(tx, event.tenantId);
        const toEnqueue: { deliveryId: string; tenantId: string }[] = [];

        for (const rule of rules) {
          let recipients: ResolvedRecipient[];
          try {
            recipients = await this.resolver.resolve(tx, event.tenantId, rule, built.refs);
          } catch (err) {
            this.logger.error(
              `recipient resolution failed for rule ${rule.key} on ${event.id}: ${String(err)}`,
            );
            continue;
          }

          for (const recipient of recipients) {
            const created = await this.materialise(
              tx,
              event,
              rule,
              recipient,
              built.context,
              templateOverrides,
            );
            toEnqueue.push(...created);
          }
        }
        return toEnqueue;
      },
    );

    for (const job of enqueue) {
      await this.queue?.add('deliver', job, { jobId: job.deliveryId });
    }
    return { created: enqueue.length };
  }

  /** Create (idempotently) the notification row + one delivery per channel. */
  private async materialise(
    tx: Tx,
    event: HandledEvent,
    rule: EffectiveRule,
    recipient: ResolvedRecipient,
    context: Record<string, unknown>,
    templateOverrides: Map<string, TenantTemplateOverride>,
  ): Promise<{ deliveryId: string; tenantId: string }[]> {
    const inAppTpl = mergeTemplate(
      rule.templateKey,
      'in_app',
      templateOverrides.get(`${rule.templateKey}:in_app`),
    );
    if (!inAppTpl) {
      this.logger.error(`missing template ${rule.templateKey} for rule ${rule.key}`);
      return [];
    }

    let title: string;
    let body: string;
    try {
      title = renderRequired(inAppTpl.title, context, inAppTpl.requiredVars);
      body = renderRequired(inAppTpl.body, context, inAppTpl.requiredVars);
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOTIFICATION_TEMPLATE_INVALID') {
        this.logger.warn(
          `template ${rule.templateKey} missing required vars for ${event.id} — skipping (${JSON.stringify(err.details)})`,
        );
        return [];
      }
      throw err;
    }

    const deepLink = rule.deepLink ? renderTemplate(rule.deepLink, context).text : null;
    const dedupeKey = notificationDedupeKey({
      eventId: event.id,
      ruleKey: rule.key,
      recipientRef: recipient.ref,
    });

    const notificationId = await this.upsertNotification(tx, {
      tenantId: event.tenantId,
      dedupeKey,
      recipientMembershipId: recipient.membershipId ?? null,
      recipientEmail: recipient.membershipId ? null : (recipient.email ?? null),
      type: rule.notificationType,
      title,
      body,
      deepLink: deepLink && deepLink.length > 0 ? deepLink : null,
      sourceEventId: event.id,
      sourceEventType: event.type,
      ruleKey: rule.key,
    });

    const jobs: { deliveryId: string; tenantId: string }[] = [];
    for (const channel of rule.channels) {
      const recipientRef = channel === 'email' ? recipient.email : recipient.membershipId;
      if (!recipientRef) {
        if (channel === 'email') {
          this.logger.warn(
            `rule ${rule.key}: no email address for recipient ${recipient.ref} — skipping email`,
          );
        }
        continue;
      }

      const meta = this.renderChannelMeta(channel, rule, context, templateOverrides);
      const idempotencyKey = deliveryIdempotencyKey({
        eventId: event.id,
        ruleKey: rule.key,
        recipientRef,
        channel,
      });

      // Upsert (no-op on conflict) and always read the row back, so a replay
      // after a crash between commit and enqueue can re-queue an orphaned
      // `pending` delivery. `jobId = deliveryId` dedupes at the queue, so a
      // still-live job is never doubled and a `sent`/`failed` row is skipped.
      const [row] = await tx
        .insert(notificationDeliveries)
        .values({
          tenantId: event.tenantId,
          notificationId,
          channel,
          recipientRef,
          status: 'pending',
          idempotencyKey,
          meta,
        })
        .onConflictDoUpdate({
          target: [notificationDeliveries.tenantId, notificationDeliveries.idempotencyKey],
          set: { updatedAt: new Date() },
        })
        .returning({ id: notificationDeliveries.id, status: notificationDeliveries.status });

      if (row && row.status === 'pending') {
        jobs.push({ deliveryId: row.id, tenantId: event.tenantId });
      }
    }
    return jobs;
  }

  private renderChannelMeta(
    channel: NotificationChannel,
    rule: EffectiveRule,
    context: Record<string, unknown>,
    templateOverrides: Map<string, TenantTemplateOverride>,
  ): Record<string, unknown> | null {
    if (channel !== 'email') return null;
    const tpl = mergeTemplate(
      rule.templateKey,
      'email',
      templateOverrides.get(`${rule.templateKey}:email`),
    );
    if (!tpl) return null;
    return {
      emailSubject: renderTemplate(tpl.emailSubject, context).text,
      emailBody: renderTemplate(tpl.emailBody, context).text,
    };
  }

  private async upsertNotification(
    tx: Tx,
    values: typeof notifications.$inferInsert,
  ): Promise<string> {
    const [inserted] = await tx
      .insert(notifications)
      .values(values)
      .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })
      .returning({ id: notifications.id });
    if (inserted) return inserted.id;
    const [existing] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, values.tenantId),
          eq(notifications.dedupeKey, values.dedupeKey),
        ),
      )
      .limit(1);
    if (!existing) throw new Error('notification upsert produced no row');
    return existing.id;
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
