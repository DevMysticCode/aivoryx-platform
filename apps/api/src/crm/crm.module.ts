import { Module } from '@nestjs/common';
import { CrmAnalyticsController } from './analytics.controller.js';
import { CrmAnalyticsService } from './analytics.service.js';
import { CustomFieldsController } from './custom-fields.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { FollowupsService } from './followups.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { NotesService } from './notes.service.js';
import { SavedViewsController } from './saved-views.controller.js';
import { SavedViewsService } from './saved-views.service.js';

/**
 * CRM core — the reusable Lead domain (Phase 3, ADR 0031). No dependency on
 * the integrations module; the inbound pipeline depends on this module's
 * services (one-way), never the reverse.
 */
@Module({
  controllers: [
    LeadsController,
    CustomFieldsController,
    SavedViewsController,
    CrmAnalyticsController,
  ],
  providers: [
    LeadsService,
    NotesService,
    FollowupsService,
    CustomFieldsService,
    SavedViewsService,
    CrmAnalyticsService,
  ],
  exports: [LeadsService, CustomFieldsService],
})
export class CrmModule {}
