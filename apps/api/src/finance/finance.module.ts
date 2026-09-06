import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsService } from './payments.service.js';
import { PaymentAllocationService } from './allocations.service.js';
import { CreditNotesService } from './credit-notes.service.js';
import { InvoicesController } from './invoices.controller.js';
import { PaymentsController } from './payments.controller.js';
import { CreditNotesController } from './credit-notes.controller.js';
import { FinanceController } from './finance.controller.js';

/**
 * Finance — operational Invoicing & Payments (Phase 9, ADR 0038).
 *
 * An operational finance layer (invoices, payments, allocations, credit notes),
 * NOT an accounting system. Built ON the existing platform: reuses the Phase 6
 * `customers`, the `projects` / `quotations` links, the fixed-point money
 * helpers, the transactional outbox (finance events flow to Phase 8), RLS, the
 * RBAC catalogue and the OpenAPI pipeline. `AdminModule` provides `OutboxService`.
 */
@Module({
  imports: [AdminModule],
  controllers: [InvoicesController, PaymentsController, CreditNotesController, FinanceController],
  providers: [InvoicesService, PaymentsService, PaymentAllocationService, CreditNotesService],
  exports: [InvoicesService, PaymentsService],
})
export class FinanceModule {}
