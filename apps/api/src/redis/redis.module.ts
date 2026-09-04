import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { type ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { isOpenApiGeneration } from '../runtime.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Shared Redis connection (ADR 0012). `lazyConnect` means no socket is opened
 * until the first command, so creating the app for OpenAPI generation stays
 * offline. `maxRetriesPerRequest: null` is required for BullMQ.
 */
@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client && this.client.status !== 'end') {
      await this.client.quit().catch(() => this.client?.disconnect());
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [SERVER_ENV],
      useFactory: (env: ServerEnv): Redis | null => {
        if (isOpenApiGeneration()) return null;
        return new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
        });
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
