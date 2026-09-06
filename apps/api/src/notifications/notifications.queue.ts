import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { type ServerEnv } from '@aivoryx/config';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { SERVER_ENV } from '../config/config.module.js';
import { isOpenApiGeneration } from '../runtime.js';

/**
 * The `notifications` BullMQ queue (ADR 0037). Reuses the shared Redis
 * connection and the platform's existing BullMQ infrastructure — no second
 * queue technology. Two job kinds:
 *   - `drain`   : repeatable; pulls undelivered `outbox_events` into the engine
 *   - `deliver` : one per `notification_deliveries` row; retried with backoff
 */
export const NOTIFICATIONS_QUEUE = Symbol('NOTIFICATIONS_QUEUE');
export const NOTIFICATIONS_QUEUE_NAME = 'notifications';

export interface DeliverJobData {
  deliveryId: string;
  tenantId: string;
}

export function buildNotificationsQueue(connection: Redis | null, env: ServerEnv): Queue | null {
  if (isOpenApiGeneration() || !connection || !env.NOTIFICATIONS_ENABLED) return null;
  return new Queue(NOTIFICATIONS_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: env.NOTIFICATIONS_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    },
  });
}

@Injectable()
export class NotificationsQueueLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('NotificationsQueue');

  constructor(@Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.logger.log('notifications queue closed');
    }
  }
}

export const notificationsQueueProvider = {
  provide: NOTIFICATIONS_QUEUE,
  inject: [REDIS_CLIENT, SERVER_ENV],
  useFactory: buildNotificationsQueue,
};
