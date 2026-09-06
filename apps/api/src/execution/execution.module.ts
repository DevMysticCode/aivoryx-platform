import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ExecutionController, FieldProjectsController } from './execution.controller.js';
import { ExecutionService } from './execution.service.js';
import { InstallationsController } from './installations.controller.js';
import { InstallationsService } from './installations.service.js';
import { ChecklistsController, ChecklistTemplatesController } from './checklists.controller.js';
import { ChecklistsService } from './checklists.service.js';
import { QcController } from './qc.controller.js';
import { QcService } from './qc.service.js';
import { DefectsController } from './defects.controller.js';
import { DefectsService } from './defects.service.js';
import { ProjectWorkflowsController } from './project-workflows.controller.js';
import { ProjectWorkflowsService } from './workflows.service.js';
import { ExecutionAttachmentsController } from './execution-attachments.controller.js';
import { ExecutionAttachmentsService } from './execution-attachments.service.js';

/**
 * EPC Project Execution (Phase 7, ADR 0036) — takes a booked/approved Phase 5
 * project through installation → QC → net metering → handover → completion.
 * Imports `AdminModule` (shared transactional outbox) and `StorageModule`
 * (execution attachments). The installation-assignment field-agent check uses
 * the pure `isActiveFieldAgent` helper, not a provider.
 */
@Module({
  imports: [AdminModule, StorageModule],
  controllers: [
    ExecutionController,
    FieldProjectsController,
    InstallationsController,
    ChecklistsController,
    ChecklistTemplatesController,
    QcController,
    DefectsController,
    ProjectWorkflowsController,
    ExecutionAttachmentsController,
  ],
  providers: [
    ExecutionService,
    InstallationsService,
    ChecklistsService,
    QcService,
    DefectsService,
    ProjectWorkflowsService,
    ExecutionAttachmentsService,
  ],
})
export class ExecutionModule {}
