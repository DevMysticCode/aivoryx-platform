import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantSystemContext, type Tx } from '@aivoryx/db';
import { defaultRule } from './catalogue.js';
import { classifyFailure, failureCodeFor, shouldRetry } from './retry.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { InAppChannelAdapter } from './channels/in-app.adapter.js';
import { EmailChannelAdapter } from './channels/email.adapter.js';
import { SmsChannelAdapter, WhatsAppChannelAdapter } from './channels/stub-channels.js';
import type { ChannelAdapter, ChannelDeliveryRequest } from './channels/channel-adapter.js';

const { notificationDeliveries, notifications } = schema;

/**
 * Processes one `notification_deliveries` row (ADR 0037). Idempotent: a row
 * already `sent`/`cancelled` is a no-op. Preference-checked (unless the rule is
 * non-suppressible). Transient failures are re-thrown so BullMQ retries with
 * backoff; permanent failures — or exhausting the attempt budget — mark the row
 * `failed`, which is the business-facing source of truth (BullMQ's own failed
 * job is just the mechanism).
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger('NotificationDelivery');
  private readonly adapters: Map<string, ChannelAdapter>;

  constructor(
    private readonly preferences: NotificationPreferencesService,
    inApp: InAppChannelAdapter,
    email: EmailChannelAdapter,
    whatsapp: WhatsAppChannelAdapter,
    sms: SmsChannelAdapter,
  ) {
    this.adapters = new Map<string, ChannelAdapter>([
      [inApp.channel, inApp],
      [email.channel, email],
      [whatsapp.channel, whatsapp],
      [sms.channel, sms],
    ]);
  }

  async process(deliveryId: string, tenantId: string): Promise<void> {
    const outcome = await withTenantSystemContext<{
      retry: boolean;
      code?: string;
      message?: string;
    }>(getDb(), tenantId, async (tx) => {
      const record = await this.load(tx, deliveryId, tenantId);
      if (!record) {
        this.logger.warn(`delivery ${deliveryId} not found in tenant ${tenantId}`);
        return { retry: false };
      }
      if (record.status === 'sent' || record.status === 'cancelled') {
        return { retry: false };
      }

      const attempts = record.attempts + 1;
      await tx
        .update(notificationDeliveries)
        .set({ status: 'processing', attempts, lastAttemptAt: new Date(), updatedAt: new Date() })
        .where(eq(notificationDeliveries.id, deliveryId));

      // preference gate (suppressible rules only, membership recipients only)
      const rule = record.ruleKey ? defaultRule(record.ruleKey) : undefined;
      const suppressible = rule?.suppressible ?? true;
      if (suppressible && record.recipientMembershipId) {
        const prefs = await this.preferences.resolve(tx, tenantId, record.recipientMembershipId);
        if (!this.preferences.channelAllowed(prefs, record.channel)) {
          await tx
            .update(notificationDeliveries)
            .set({
              status: 'cancelled',
              failureCode: 'SUPPRESSED_BY_PREFERENCE',
              failureMessage: 'Recipient has disabled this channel.',
              updatedAt: new Date(),
            })
            .where(eq(notificationDeliveries.id, deliveryId));
          return { retry: false };
        }
      }

      const adapter = this.adapters.get(record.channel);
      if (!adapter) {
        await this.markFailed(
          tx,
          deliveryId,
          'NOTIFICATION_CHANNEL_UNAVAILABLE',
          'Unknown channel',
        );
        return { retry: false };
      }

      const meta = (record.meta ?? {}) as { emailSubject?: string; emailBody?: string };
      const request: ChannelDeliveryRequest = {
        channel: record.channel,
        recipientRef: record.recipientRef,
        title: record.title,
        body: record.body,
        emailSubject: meta.emailSubject,
        emailBody: meta.emailBody,
        correlation: {
          tenantId,
          notificationId: record.notificationId,
          deliveryId,
          eventId: record.sourceEventId,
          ruleKey: record.ruleKey,
        },
      };

      try {
        const result = await adapter.deliver(request);
        await tx
          .update(notificationDeliveries)
          .set({
            status: 'sent',
            provider: result.provider,
            providerMessageId: result.providerMessageId ?? null,
            sentAt: new Date(),
            failureCode: null,
            failureMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(notificationDeliveries.id, deliveryId));
        return { retry: false };
      } catch (err) {
        const failureClass = classifyFailure(err);
        const code = failureCodeFor(err);
        const message = truncate((err as Error).message ?? 'Delivery failed');
        if (shouldRetry(attempts, record.maxAttempts, failureClass)) {
          await tx
            .update(notificationDeliveries)
            .set({
              status: 'pending',
              failureCode: code,
              failureMessage: message,
              nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
              updatedAt: new Date(),
            })
            .where(eq(notificationDeliveries.id, deliveryId));
          return { retry: true, code, message };
        }
        await this.markFailed(tx, deliveryId, code, message);
        return { retry: false };
      }
    });

    if (outcome.retry) {
      // surface to BullMQ so it schedules the next attempt with backoff
      throw new Error(`transient delivery failure (${outcome.code}): ${outcome.message}`);
    }
  }

  private async markFailed(
    tx: Tx,
    deliveryId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await tx
      .update(notificationDeliveries)
      .set({
        status: 'failed',
        failureCode: code,
        failureMessage: truncate(message),
        updatedAt: new Date(),
      })
      .where(eq(notificationDeliveries.id, deliveryId));
  }

  private async load(tx: Tx, deliveryId: string, tenantId: string) {
    const [row] = await tx
      .select({
        id: notificationDeliveries.id,
        status: notificationDeliveries.status,
        channel: notificationDeliveries.channel,
        recipientRef: notificationDeliveries.recipientRef,
        attempts: notificationDeliveries.attempts,
        maxAttempts: notificationDeliveries.maxAttempts,
        meta: notificationDeliveries.meta,
        notificationId: notificationDeliveries.notificationId,
        title: notifications.title,
        body: notifications.body,
        ruleKey: notifications.ruleKey,
        sourceEventId: notifications.sourceEventId,
        recipientMembershipId: notifications.recipientMembershipId,
      })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
      .where(
        and(
          eq(notificationDeliveries.tenantId, tenantId),
          eq(notificationDeliveries.id, deliveryId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function backoffMs(attempt: number): number {
  return Math.min(5000 * 2 ** (attempt - 1), 5 * 60_000);
}
