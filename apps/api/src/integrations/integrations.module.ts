import { Module } from '@nestjs/common';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { IngestionService } from './ingestion.service.js';
import { IntegrationsAdminController } from './integrations-admin.controller.js';
import { WEBHOOK_RATE_LIMITER, TokenBucketRateLimiter } from './rate-limiter.js';
import { RawEventRetentionService } from './raw-event-retention.service.js';
import { SourcesService } from './sources.service.js';
import { WebhookController } from './webhook.controller.js';

/**
 * Inbound integration engine (Phase 3, ADR 0032). Imports `AdminModule` to
 * reuse its `OutboxService` — deliberately not a second outbox mechanism.
 * Depends on `@aivoryx/db` + the CRM module's pure/query helpers only; the CRM
 * module has no dependency back on this one.
 */
@Module({
  imports: [AdminModule],
  controllers: [WebhookController, IntegrationsAdminController],
  providers: [
    SourcesService,
    IngestionService,
    RawEventRetentionService,
    {
      // In-process token bucket behind the RateLimiter interface; swap this provider to change
      // the implementation (e.g. Redis) without touching ingestion code.
      provide: WEBHOOK_RATE_LIMITER,
      inject: [SERVER_ENV],
      useFactory: (env: ServerEnv) =>
        new TokenBucketRateLimiter({
          capacity: env.WEBHOOK_RATE_LIMIT_MAX,
          windowSeconds: env.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS,
        }),
    },
  ],
  exports: [SourcesService, IngestionService, RawEventRetentionService],
})
export class IntegrationsModule {}
