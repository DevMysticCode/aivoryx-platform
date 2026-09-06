import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import {
  buildEntityAttachmentKey,
  OBJECT_STORAGE,
  type ObjectStorageService,
} from '../storage/object-storage.service.js';
import { hrScope } from './common.js';
import { ExpensesService } from './expenses.service.js';
import { SelfServiceService } from './self-service.service.js';
import {
  CreateExpenseClaimDto,
  ExpenseCategoryDto,
  ExpenseClaimDto,
  ExpenseClaimListDto,
  ExpenseDecisionDto,
  ListExpenseQueryDto,
  RecordReimbursementDto,
  UpsertExpenseCategoryDto,
} from './hr.dto.js';

const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Expense claims & reimbursements (Phase 12, ADR 0041) — a first-class HR
 * workflow. Field agents raise claims through the SAME domain via a narrow
 * capability ({@link ExpensesService.createClaimFor}); Field never touches HR
 * tables. HR owns "I am owed a reimbursement"; Finance owns settlement — this
 * module records operational payment state only, it is not an accounting ledger.
 * Self-approval is forbidden; approved amounts are immutable.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/expenses')
export class HrExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly selfService: SelfServiceService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
  ) {}

  // ---- categories -------------------------------

  @Get('categories')
  @RequirePermission('hr.expense.read')
  @ApiOperation({ operationId: 'listHrExpenseCategories', summary: 'List expense categories.' })
  @ApiOkResponse({ type: [ExpenseCategoryDto] })
  listCategories(@Security() ctx: SecurityContext) {
    return this.expenses.listCategories(hrScope(ctx));
  }

  @Post('categories')
  @HttpCode(200)
  @RequirePermission('hr.expense.manage')
  @ApiOperation({ operationId: 'createHrExpenseCategory', summary: 'Create an expense category.' })
  @ApiOkResponse({ type: ExpenseCategoryDto })
  createCategory(@Security() ctx: SecurityContext, @Body() body: UpsertExpenseCategoryDto) {
    return this.expenses.upsertCategory(hrScope(ctx), body);
  }

  @Patch('categories/:id')
  @RequirePermission('hr.expense.manage')
  @ApiOperation({ operationId: 'updateHrExpenseCategory', summary: 'Update an expense category.' })
  @ApiOkResponse({ type: ExpenseCategoryDto })
  updateCategory(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpsertExpenseCategoryDto,
  ) {
    return this.expenses.upsertCategory(hrScope(ctx), body, id);
  }

  // ---- claims ----------------------------------

  @Get()
  @RequirePermission('hr.expense.read')
  @ApiOperation({ operationId: 'listHrExpenseClaims', summary: 'Search expense claims.' })
  @ApiOkResponse({ type: ExpenseClaimListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListExpenseQueryDto) {
    return this.expenses.list(hrScope(ctx), query);
  }

  @Get('my-claims')
  @RequirePermission('hr.expense.submit')
  @ApiOperation({ operationId: 'listMyHrExpenseClaims', summary: 'My own expense claims.' })
  @ApiOkResponse({ type: ExpenseClaimListDto })
  async myClaims(@Security() ctx: SecurityContext, @Query() query: ListExpenseQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.expenses.list(scope, { ...query, employeeId });
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('hr.expense.submit')
  @ApiOperation({
    operationId: 'createHrExpenseClaim',
    summary: 'Create an expense claim (self-service unless employeeId given).',
  })
  @ApiOkResponse({ type: ExpenseClaimDto })
  createClaim(@Security() ctx: SecurityContext, @Body() body: CreateExpenseClaimDto) {
    return this.expenses.createClaim(hrScope(ctx), body, ctx.permissions.has('hr.expense.manage'));
  }

  @Get(':id')
  @RequirePermission('hr.expense.read')
  @ApiOperation({ operationId: 'getHrExpenseClaim', summary: 'One expense claim.' })
  @ApiOkResponse({ type: ExpenseClaimDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.expenses.get(hrScope(ctx), id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('hr.expense.submit')
  @ApiOperation({
    operationId: 'submitHrExpenseClaim',
    summary: 'Submit a draft claim for approval.',
  })
  @ApiOkResponse({ type: ExpenseClaimDto })
  submit(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.expenses.submit(hrScope(ctx), id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('hr.expense.approve')
  @ApiOperation({ operationId: 'approveHrExpenseClaim', summary: 'Approve an expense claim.' })
  @ApiOkResponse({ type: ExpenseClaimDto })
  approve(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: ExpenseDecisionDto,
  ) {
    return this.expenses.decide(hrScope(ctx), id, 'APPROVED', body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('hr.expense.approve')
  @ApiOperation({ operationId: 'rejectHrExpenseClaim', summary: 'Reject an expense claim.' })
  @ApiOkResponse({ type: ExpenseClaimDto })
  reject(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: ExpenseDecisionDto,
  ) {
    return this.expenses.decide(hrScope(ctx), id, 'REJECTED', body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('hr.expense.submit')
  @ApiOperation({ operationId: 'cancelHrExpenseClaim', summary: 'Cancel an expense claim.' })
  @ApiOkResponse({ type: ExpenseClaimDto })
  cancel(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.expenses.cancel(hrScope(ctx), id, ctx.permissions.has('hr.expense.manage'));
  }

  @Post(':id/reimburse')
  @HttpCode(200)
  @RequirePermission('hr.expense.reimburse')
  @ApiOperation({
    operationId: 'reimburseHrExpenseClaim',
    summary: 'Record a reimbursement payment.',
  })
  @ApiOkResponse({ type: ExpenseClaimDto })
  reimburse(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: RecordReimbursementDto,
  ) {
    return this.expenses.reimburse(hrScope(ctx), id, body);
  }

  // ---- receipt attachment ----------------------

  @Post(':id/receipt')
  @HttpCode(200)
  @RequirePermission('hr.expense.submit')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ operationId: 'uploadHrExpenseReceipt', summary: 'Attach a receipt to a claim.' })
  @ApiOkResponse({ type: ExpenseClaimDto })
  async uploadReceipt(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'no_file' } });
    if (file.size > RECEIPT_MAX_BYTES)
      throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'file_too_large' } });
    const scope = hrScope(ctx);
    const objectKey = buildEntityAttachmentKey(
      scope.tenantId,
      'hr-expenses',
      id,
      file.originalname,
    );
    await this.storage.putObject({ key: objectKey, body: file.buffer, contentType: file.mimetype });
    await this.expenses.setReceiptKey(scope, id, objectKey);
    return this.expenses.get(scope, id);
  }

  @Get(':id/receipt')
  @RequirePermission('hr.expense.read')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiOperation({ operationId: 'downloadHrExpenseReceipt', summary: 'Download a claim receipt.' })
  async downloadReceipt(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const scope = hrScope(ctx);
    const key = await this.expenses.receiptObjectKey(scope, id);
    if (!key) throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'no_receipt' } });
    const object = await this.storage.getObject(key);
    if (!object)
      throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'missing_object' } });
    return new StreamableFile(object.body, { type: object.contentType });
  }
}
