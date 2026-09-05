import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { IngestionService } from './ingestion.service.js';
import { IntegrationsAdminController } from './integrations-admin.controller.js';
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
  providers: [SourcesService, IngestionService],
  exports: [SourcesService, IngestionService],
})
export class IntegrationsModule {}
