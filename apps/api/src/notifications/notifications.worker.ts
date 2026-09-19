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
import { DRAIN_SAFE_MIN_MS, removeStaleDrainSchedules, startPoller } from './drain-schedule.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

/**
 * The notification background worker (ADR 0037). One BullMQ worker on the
 * shared Redis connection handles two job kinds:
 *   - `drain`   : legacy job name, still handled if one is in flight; the outbox is
 *                 now polled in-process every `NOTIFICATIONS_POLL_MS` (Postgres only)
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
  private poller: { stop: () => void } | null = null;

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
      {
        connection: this.connection,
        concurrency: 5,
        // Idle Redis cost: the blocking wait and the stalled-job sweep each cost a
        // handful of commands per cycle. New/delayed (retry) jobs still wake the
        // worker immediately; only the idle heartbeat gets slower.
        drainDelay: 300,
        stalledInterval: 300_000,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`job ${job?.name} ${job?.id} failed: ${err.message}`);
    });

    // The outbox drain is an in-process Postgres poll (no Redis traffic while
    // idle). Delete any BullMQ repeatable `drain` schedules earlier deployments
    // registered in Redis — they would otherwise keep firing every few seconds.
    const removed = await removeStaleDrainSchedules(this.queue);
    if (removed > 0) this.logger.warn(`removed ${removed} stale BullMQ drain schedule(s)`);
    if (this.env.NOTIFICATIONS_POLL_MS < DRAIN_SAFE_MIN_MS) {
      this.logger.warn(
        `NOTIFICATIONS_POLL_MS=${this.env.NOTIFICATIONS_POLL_MS} is below ${DRAIN_SAFE_MIN_MS}ms`,
      );
    }
    this.poller = startPoller(
      () => this.dispatcher.drain(),
      this.env.NOTIFICATIONS_POLL_MS,
      (err) => this.logger.error(`outbox drain failed: ${String(err)}`),
    );
    this.logger.log(
      `notification worker started (poll ${this.env.NOTIFICATIONS_POLL_MS}ms, provider ${this.env.EMAIL_PROVIDER})`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.poller?.stop();
    this.poller = null;
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
