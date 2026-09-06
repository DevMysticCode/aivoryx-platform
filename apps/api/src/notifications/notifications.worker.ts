import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { type ServerEnv } from '@aivoryx/config';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { SERVER_ENV } from '../config/config.module.js';
import { isOpenApiGeneration } from '../runtime.js';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATIONS_QUEUE_NAME,
  type DeliverJobData,
} from './notifications.queue.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

/**
 * The notification background worker (ADR 0037). One BullMQ worker on the
 * shared Redis connection handles two job kinds:
 *   - `drain`   : repeatable (every `NOTIFICATIONS_POLL_MS`) — pulls the outbox
 *   - `deliver` : per delivery row — retried by BullMQ with exponential backoff;
 *                 the delivery service re-throws only for transient failures.
 *
 * Off entirely when `NOTIFICATIONS_ENABLED=false`, during OpenAPI generation, or
 * when Redis is unavailable.
 */
@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('NotificationsWorker');
  private worker: Worker | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly connection: Redis | null,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
    @Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue | null,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (
      isOpenApiGeneration() ||
      !this.env.NOTIFICATIONS_ENABLED ||
      !this.connection ||
      !this.queue
    ) {
      return;
    }

    this.worker = new Worker(
      NOTIFICATIONS_QUEUE_NAME,
      async (job: Job) => {
        if (job.name === 'drain') {
          return this.dispatcher.drain();
        }
        if (job.name === 'deliver') {
          const { deliveryId, tenantId } = job.data as DeliverJobData;
          await this.delivery.process(deliveryId, tenantId);
          return;
        }
        this.logger.warn(`unknown job ${job.name}`);
      },
      { connection: this.connection, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`job ${job?.name} ${job?.id} failed: ${err.message}`);
    });

    // repeatable outbox drain — idempotent jobId so restarts don't stack it
    await this.queue.add(
      'drain',
      {},
      {
        jobId: 'notifications:drain',
        repeat: { every: this.env.NOTIFICATIONS_POLL_MS },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    // one immediate drain so a just-booted process doesn't wait a full interval
    await this.queue.add('drain', {}, { removeOnComplete: true, removeOnFail: 50 });
    this.logger.log(
      `notification worker started (poll ${this.env.NOTIFICATIONS_POLL_MS}ms, provider ${this.env.EMAIL_PROVIDER})`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /** Test hook: run one drain synchronously without the queue. */
  async drainNow(): Promise<number> {
    return this.dispatcher.drain();
  }
}
