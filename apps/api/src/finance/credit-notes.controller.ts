import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
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
import { scope } from './common.js';
import { CreditNotesService } from './credit-notes.service.js';
import {
  CancelCreditNoteDto,
  CreateCreditNoteDto,
  CreditNoteDto,
  CreditNoteListDto,
  ListCreditNotesQueryDto,
} from './finance.dto.js';

/** Credit notes / adjustments (Phase 9, ADR 0038). */
@ApiTags('finance')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('finance/credit-notes')
export class CreditNotesController {
  constructor(private readonly creditNotes: CreditNotesService) {}

  @Get()
  @RequirePermission('finance.credit_notes.read')
  @ApiOperation({ operationId: 'listCreditNotes', summary: 'Search credit notes.' })
  @ApiOkResponse({ type: CreditNoteListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListCreditNotesQueryDto) {
    return this.creditNotes.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('finance.credit_notes.read')
  @ApiOperation({ operationId: 'getCreditNote', summary: 'One credit note.' })
  @ApiOkResponse({ type: CreditNoteDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.creditNotes.get(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('finance.credit_notes.create')
  @ApiOperation({ operationId: 'createCreditNote', summary: 'Create a draft credit note.' })
  @ApiOkResponse({ type: CreditNoteDto })
  create(
    @Security() ctx: SecurityContext,
    @Body() body: CreateCreditNoteDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.creditNotes.create(scope(ctx), body, idempotencyKey);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermission('finance.credit_notes.issue')
  @ApiOperation({ operationId: 'issueCreditNote', summary: 'Issue a credit note.' })
  @ApiOkResponse({ type: CreditNoteDto })
  issue(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.creditNotes.issue(scope(ctx), id, idempotencyKey);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('finance.credit_notes.cancel')
  @ApiOperation({ operationId: 'cancelCreditNote', summary: 'Cancel a credit note.' })
  @ApiOkResponse({ type: CreditNoteDto })
  cancel(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: CancelCreditNoteDto,
  ) {
    return this.creditNotes.cancel(scope(ctx), id, body.reason);
  }
}
