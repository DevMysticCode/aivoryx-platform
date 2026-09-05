import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { FieldAgentsController } from './field-agents.controller.js';
import { FieldAgentsService } from './field-agents.service.js';
import { VisitAttachmentsService } from './visit-attachments.service.js';
import { VisitNotesService } from './visit-notes.service.js';
import { VisitsController } from './visits.controller.js';
import { VisitsService } from './visits.service.js';

/**
 * Field operations — visits, GPS, survey, attachments (Phase 4, ADR 0033).
 * A business domain built ON the platform: imports `AdminModule` (outbox)
 * and `StorageModule` (object storage), and calls the CRM module's exported
 * pure query/service functions directly (lead queries, the generalized
 * custom-fields engine) — no second identity/tenancy/RLS/RBAC/event/storage
 * mechanism.
 */
@Module({
  imports: [AdminModule, StorageModule],
  controllers: [FieldAgentsController, VisitsController],
  providers: [FieldAgentsService, VisitsService, VisitNotesService, VisitAttachmentsService],
  exports: [FieldAgentsService, VisitsService],
})
export class FieldModule {}
