import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { ExpensesService } from '../hr/expenses.service.js';
import { ExpenseClaimDto } from '../hr/hr.dto.js';
import { VisitsService } from './visits.service.js';
import { CreateFieldExpenseClaimRequestDto } from './field.dto.js';

/**
 * Field → HR expense-claim seam (Phase 12, ADR 0041).
 *
 * This is the ONLY point where the Field module reaches into HR, and it does so
 * through the narrow, HR-exported `ExpensesService.createFromFieldVisit`
 * capability — never HR tables, HR schema types, or any other HR service.
 *
 * Ownership is entirely server-derived:
 *  - tenant + actor: from the authenticated `SecurityContext`;
 *  - visit: `VisitsService.get` loads it under RLS and rejects a visit that is
 *    not the caller's (unless they hold the CRM/admin visibility permission);
 *  - employee: resolved inside HR from the caller's membership — a field agent
 *    can only ever raise a claim for themselves, and only if their account is
 *    linked to an employee record (else `HR_EMPLOYEE_NOT_LINKED`).
 *
 * The visit id is passed to HR as an opaque `visitRef` soft reference; HR
 * stores it and never dereferences it.
 */
@ApiTags('field')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('field/visits')
export class FieldExpensesController {
  constructor(
    private readonly visits: VisitsService,
    private readonly expenses: ExpensesService,
  ) {}

  @Post(':visitId/expense-claim')
  @HttpCode(200)
  @RequirePermission('hr.expense.submit')
  @ApiOperation({
    operationId: 'createFieldVisitExpenseClaim',
    summary: 'Raise an HR expense claim for a visit the caller worked.',
  })
  @ApiOkResponse({ type: ExpenseClaimDto })
  async createClaim(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: CreateFieldExpenseClaimRequestDto,
  ): Promise<ExpenseClaimDto> {
    if (!ctx.tenantId || !ctx.membership) throw new Error('no active tenant');
    const scope = {
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
    };
    // Server-side visit ownership check (throws VISIT_NOT_FOUND /
    // VISIT_NOT_ASSIGNED_TO_YOU). A field agent may only claim against a visit
    // assigned to them; CRM/admins (crm.leads.read) may claim against any.
    await this.visits.get(scope, visitId, {
      canSeeAll: ctx.permissions.has('crm.leads.read'),
    });

    return this.expenses.createFromFieldVisit(scope, {
      visitId,
      categoryId: body.categoryId,
      expenseDate: body.expenseDate,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      merchant: body.merchant,
      distanceKm: body.distanceKm,
      notes: body.notes,
      autoSubmit: body.autoSubmit ?? true,
    });
  }
}
