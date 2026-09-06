import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { LeadQuotationsController, QuotationsController } from './quotations.controller.js';
import { QuotationsService } from './quotations.service.js';

/**
 * Commercial — customers, quotations & project booking (Phase 6, ADR 0035).
 * The commercial bridge from a qualified CRM lead to an operationally
 * activated Phase 5 project. Imports `AdminModule` for the shared
 * transactional outbox and `StorageModule` for quotation attachments; booking
 * creates/activates the existing `projects` row directly (no second project
 * entity).
 */
@Module({
  imports: [AdminModule, StorageModule, DocumentsModule],
  controllers: [CustomersController, QuotationsController, LeadQuotationsController],
  providers: [CustomersService, QuotationsService],
  exports: [CustomersService, QuotationsService],
})
export class CommercialModule {}
