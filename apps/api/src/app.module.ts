import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { AppLoggerModule } from './observability/logger.module.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { DbModule } from './db/db.module.js';
import { RedisModule } from './redis/redis.module.js';
import { QueueModule } from './queue/queue.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * Composition root. Phase 1 wires only cross-cutting platform infrastructure.
 * Business/domain modules (CRM, HR, ...) are added under `src/modules/` in
 * later phases — see `src/modules/README.md`.
 *
 * The correlation-id handler is registered as a global Express middleware in
 * `bootstrap/configure-app.ts` (runs before the exception filter).
 */
@Module({
  imports: [AppConfigModule, AppLoggerModule, DbModule, RedisModule, QueueModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
