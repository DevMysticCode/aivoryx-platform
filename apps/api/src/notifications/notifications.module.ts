import { Module } from '@nestjs/common';
import { EmailModule } from './email/email.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsAdminController } from './notifications-admin.controller.js';
import { NotificationsUserService } from './notifications.user.service.js';
import { NotificationsAdminService } from './notifications.admin.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationEngineService } from './notification-engine.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { RecipientResolver } from './recipient-resolver.js';
import { NotificationsWorker } from './notifications.worker.js';
import { NotificationsQueueLifecycle, notificationsQueueProvider } from './notifications.queue.js';
import { InAppChannelAdapter } from './channels/in-app.adapter.js';
import { EmailChannelAdapter } from './channels/email.adapter.js';
import { SmsChannelAdapter, WhatsAppChannelAdapter } from './channels/stub-channels.js';

/**
 * Notifications & Communications Engine (Phase 8, ADR 0037).
 *
 * Consumes the existing transactional outbox, resolves recipients, renders safe
 * templates, respects preferences, and delivers over pluggable channels
 * (in-app + email functional; WhatsApp/SMS interface-only). Reuses the shared
 * Redis + BullMQ infrastructure — no second queue, no second event bus.
 */
@Module({
  imports: [EmailModule],
  controllers: [NotificationsController, NotificationsAdminController],
  providers: [
    notificationsQueueProvider,
    NotificationsQueueLifecycle,
    RecipientResolver,
    NotificationPreferencesService,
    NotificationEngineService,
    NotificationDeliveryService,
    OutboxDispatcherService,
    NotificationsWorker,
    NotificationsUserService,
    NotificationsAdminService,
    InAppChannelAdapter,
    EmailChannelAdapter,
    WhatsAppChannelAdapter,
    SmsChannelAdapter,
  ],
  exports: [NotificationEngineService, OutboxDispatcherService, NotificationsWorker],
})
export class NotificationsModule {}
