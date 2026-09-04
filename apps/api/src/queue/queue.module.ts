import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { isOpenApiGeneration } from '../runtime.js';

/**
 * Names of the queues the platform owns. Business queues (lead ingestion,
 * notifications, ...) are added by their modules in later phases. `system` is
 * the only Phase-1 queue and has no processor yet — this module just wires the
 * BullMQ infrastructure (task 13).
 */
export const QUEUE_NAMES = {
  system: 'system',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const SYSTEM_QUEUE = Symbol('SYSTEM_QUEUE');

@Injectable()
export class QueueLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueLifecycle.name);

  constructor(@Inject(SYSTEM_QUEUE) private readonly systemQueue: Queue | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.systemQueue) {
      await this.systemQueue.close();
      this.logger.log('system queue closed');
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SYSTEM_QUEUE,
      inject: [REDIS_CLIENT],
      useFactory: (connection: Redis | null): Queue | null => {
        if (isOpenApiGeneration() || !connection) return null;
        return new Queue(QUEUE_NAMES.system, {
          connection,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86_400 },
          },
        });
      },
    },
    QueueLifecycle,
  ],
  exports: [SYSTEM_QUEUE],
})
export class QueueModule {}
