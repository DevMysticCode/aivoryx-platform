import type { NotificationChannel } from '../catalogue.js';

/**
 * Channel adapter contract (ADR 0037). Adapters receive an already-rendered,
 * already-authorised payload — they never see the raw event, the template or
 * the recipient-resolution logic. Adding a channel = implementing this
 * interface + registering it; the engine is unchanged.
 */
export interface ChannelDeliveryRequest {
  channel: NotificationChannel;
  /** membership id (in-app) or email address (email) */
  recipientRef: string;
  title: string;
  body: string;
  emailSubject?: string;
  emailBody?: string;
  correlation: {
    tenantId: string;
    notificationId: string;
    deliveryId: string;
    eventId?: string | null;
    ruleKey?: string | null;
  };
}

export interface ChannelDeliveryResult {
  provider: string;
  providerMessageId?: string;
}

export interface ChannelAdapter {
  readonly channel: NotificationChannel;
  /** true when this deployment can actually deliver on the channel */
  readonly available: boolean;
  deliver(request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult>;
}

export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');
