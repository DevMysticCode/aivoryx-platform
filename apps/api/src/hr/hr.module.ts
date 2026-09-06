import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OrganizationService } from './organization.service.js';
import { DashboardService } from './dashboard.service.js';
import { EmployeesService } from './employees.service.js';
import { BankDetailsService } from './bank-details.service.js';
import { AttendanceService } from './attendance.service.js';
import { LeaveService } from './leave.service.js';
import { ExpensesService } from './expenses.service.js';
import { CompensationService } from './compensation.service.js';
import { IncentivesService } from './incentives.service.js';
import { PayrollService } from './payroll.service.js';
import { PerformanceService } from './performance.service.js';
import { SelfServiceService } from './self-service.service.js';
import { HrOrganizationController } from './hr-organization.controller.js';
import { HrEmployeesController } from './hr-employees.controller.js';
import { HrAttendanceController } from './hr-attendance.controller.js';
import { HrLeaveController } from './hr-leave.controller.js';
import { HrExpensesController } from './hr-expenses.controller.js';
import { HrPayrollController } from './hr-payroll.controller.js';
import { HrIncentivesController } from './hr-incentives.controller.js';
import { HrPerformanceController } from './hr-performance.controller.js';
import { HrMeController } from './hr-me.controller.js';

/**
 * HR & Workforce (Phase 12, ADR 0041).
 *
 * A BOUNDED DOMAIN MODULE. It depends only on shared kernel primitives —
 * `@aivoryx/shared`, `@aivoryx/db` (schema + RLS context), the platform
 * security context, `AdminModule` (transactional `OutboxService`),
 * `AuditModule` (global `AuditService`), `StorageModule` (object storage
 * abstraction) and `DocumentsModule` (branded PDF engine). It has NO dependency
 * on CRM / Field / Supply / EPC / Finance internals, and no HR table carries a
 * foreign key into another business module (cross-module links are soft
 * references). `ExpensesService` is exported as the single narrow capability
 * other modules (e.g. Field) use to raise an expense claim without touching HR
 * schema — the seam along which HR could later be extracted into its own
 * deployable service.
 */
@Module({
  imports: [AdminModule, DocumentsModule, StorageModule],
  controllers: [
    HrOrganizationController,
    HrEmployeesController,
    HrAttendanceController,
    HrLeaveController,
    HrExpensesController,
    HrPayrollController,
    HrIncentivesController,
    HrPerformanceController,
    HrMeController,
  ],
  providers: [
    OrganizationService,
    DashboardService,
    EmployeesService,
    BankDetailsService,
    AttendanceService,
    LeaveService,
    ExpensesService,
    CompensationService,
    IncentivesService,
    PayrollService,
    PerformanceService,
    SelfServiceService,
  ],
  exports: [ExpensesService],
})
export class HrModule {}
