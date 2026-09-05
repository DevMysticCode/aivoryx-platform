import { Module } from '@nestjs/common';
import { CustomFieldsController } from './custom-fields.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { FollowupsService } from './followups.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { NotesService } from './notes.service.js';

/**
 * CRM core — the reusable Lead domain (Phase 3, ADR 0031). No dependency on
 * the integrations module; the inbound pipeline depends on this module's
 * services (one-way), never the reverse.
 */
@Module({
  controllers: [LeadsController, CustomFieldsController],
  providers: [LeadsService, NotesService, FollowupsService, CustomFieldsService],
  exports: [LeadsService, CustomFieldsService],
})
export class CrmModule {}
