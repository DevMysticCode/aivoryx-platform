import {
  Body,
  Controller,
  Delete,
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
import { EmployeesService } from './employees.service.js';
import { BankDetailsService } from './bank-details.service.js';
import { CompensationService } from './compensation.service.js';
import {
  AddEmployeeDocumentMetaDto,
  BankDetailsDto,
  ChangeEmployeeStatusDto,
  CompensationDto,
  CreateCompensationDto,
  CreateEmployeeDto,
  EmployeeDetailDto,
  EmployeeDocumentDto,
  EmployeeListDto,
  EmploymentHistoryItemDto,
  LinkMembershipDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
  UpsertBankDetailsDto,
} from './hr.dto.js';
import type { EmployeeStatus } from './lifecycles.js';

const DOC_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Employees (Phase 12, ADR 0041). An Employee is NOT an identity: it may link
 * to a `user_tenant_memberships` row but never stores credentials, sessions,
 * roles or permissions. Sensitive sub-resources (compensation, bank details)
 * are gated by their own dedicated permissions and are never present in the
 * employee list DTO.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/employees')
export class HrEmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly bank: BankDetailsService,
    private readonly compensation: CompensationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
  ) {}

  @Get()
  @RequirePermission('hr.employee.read')
  @ApiOperation({ operationId: 'listHrEmployees', summary: 'Search employees.' })
  @ApiOkResponse({ type: EmployeeListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListEmployeesQueryDto) {
    return this.employees.list(hrScope(ctx), query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('hr.employee.create')
  @ApiOperation({ operationId: 'createHrEmployee', summary: 'Create an employee.' })
  @ApiOkResponse({ type: EmployeeDetailDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateEmployeeDto) {
    return this.employees.create(hrScope(ctx), body);
  }

  @Get(':id')
  @RequirePermission('hr.employee.read')
  @ApiOperation({ operationId: 'getHrEmployee', summary: 'One employee profile.' })
  @ApiOkResponse({ type: EmployeeDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.employees.get(hrScope(ctx), id);
  }

  @Patch(':id')
  @RequirePermission('hr.employee.update')
  @ApiOperation({ operationId: 'updateHrEmployee', summary: 'Update an employee.' })
  @ApiOkResponse({ type: EmployeeDetailDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDto,
  ) {
    return this.employees.update(hrScope(ctx), id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('hr.employee.manage')
  @ApiOperation({
    operationId: 'changeHrEmployeeStatus',
    summary: 'Transition employee lifecycle status.',
  })
  @ApiOkResponse({ type: EmployeeDetailDto })
  changeStatus(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: ChangeEmployeeStatusDto,
  ) {
    return this.employees.changeStatus(
      hrScope(ctx),
      id,
      body.status as EmployeeStatus,
      body.reason,
    );
  }

  @Get(':id/history')
  @RequirePermission('hr.employee.read')
  @ApiOperation({
    operationId: 'hrEmployeeHistory',
    summary: 'Employment history (effective-dated).',
  })
  @ApiOkResponse({ type: [EmploymentHistoryItemDto] })
  history(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.employees.history(hrScope(ctx), id);
  }

  // ---- membership link -----------------------------

  @Post(':id/membership')
  @HttpCode(200)
  @RequirePermission('hr.employee.manage')
  @ApiOperation({
    operationId: 'linkHrEmployeeMembership',
    summary: 'Link a platform membership to the employee.',
  })
  @ApiOkResponse({ type: EmployeeDetailDto })
  linkMembership(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: LinkMembershipDto,
  ) {
    return this.employees.linkMembership(hrScope(ctx), id, body.membershipId);
  }

  @Delete(':id/membership')
  @RequirePermission('hr.employee.manage')
  @ApiOperation({
    operationId: 'unlinkHrEmployeeMembership',
    summary: 'Unlink the platform membership.',
  })
  @ApiOkResponse({ type: EmployeeDetailDto })
  unlinkMembership(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.employees.unlinkMembership(hrScope(ctx), id);
  }

  // ---- documents ----------------------------------

  @Get(':id/documents')
  @RequirePermission('hr.employee.read')
  @ApiOperation({ operationId: 'listHrEmployeeDocuments', summary: 'List employee documents.' })
  @ApiOkResponse({ type: [EmployeeDocumentDto] })
  listDocuments(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.employees.listDocuments(hrScope(ctx), id);
  }

  @Post(':id/documents')
  @HttpCode(200)
  @RequirePermission('hr.employee.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    operationId: 'uploadHrEmployeeDocument',
    summary: 'Attach a document to an employee.',
  })
  @ApiOkResponse({ type: [EmployeeDocumentDto] })
  async uploadDocument(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() meta: AddEmployeeDocumentMetaDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'no_file' } });
    if (file.size > DOC_MAX_BYTES)
      throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'file_too_large' } });
    const scope = hrScope(ctx);
    const objectKey = buildEntityAttachmentKey(
      scope.tenantId,
      'hr-employees',
      id,
      file.originalname,
    );
    await this.storage.putObject({ key: objectKey, body: file.buffer, contentType: file.mimetype });
    return this.employees.attachDocument(scope, id, {
      kind: meta.kind,
      title: meta.title,
      objectKey,
      contentType: file.mimetype,
      sizeBytes: file.size,
      originalFilename: file.originalname ?? null,
    });
  }

  @Get(':id/documents/:documentId/download')
  @RequirePermission('hr.employee.read')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiOperation({
    operationId: 'downloadHrEmployeeDocument',
    summary: 'Download an employee document.',
  })
  async downloadDocument(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ): Promise<StreamableFile> {
    const scope = hrScope(ctx);
    const key = await this.employees.documentObjectKey(scope, id, documentId);
    const object = await this.storage.getObject(key);
    if (!object)
      throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'missing_object' } });
    return new StreamableFile(object.body, { type: object.contentType });
  }

  // ---- compensation (highly sensitive) ------------

  @Get(':id/compensation')
  @RequirePermission('hr.compensation.read')
  @ApiOperation({
    operationId: 'hrEmployeeCompensationHistory',
    summary: 'Compensation history (sensitive).',
  })
  @ApiOkResponse({ type: [CompensationDto] })
  compensationHistory(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.compensation.history(hrScope(ctx), id);
  }

  @Post(':id/compensation')
  @HttpCode(200)
  @RequirePermission('hr.compensation.manage')
  @ApiOperation({
    operationId: 'createHrEmployeeCompensation',
    summary: 'Set a new effective-dated compensation.',
  })
  @ApiOkResponse({ type: CompensationDto })
  createCompensation(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: CreateCompensationDto,
  ) {
    return this.compensation.create(hrScope(ctx), id, body);
  }

  // ---- bank details (highly sensitive; masked) ----

  @Get(':id/bank-details')
  @RequirePermission('hr.bank_details.read')
  @ApiOperation({
    operationId: 'getHrEmployeeBankDetails',
    summary: 'Bank details (masked, sensitive).',
  })
  @ApiOkResponse({ type: BankDetailsDto })
  getBankDetails(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.bank.get(hrScope(ctx), id);
  }

  @Post(':id/bank-details')
  @HttpCode(200)
  @RequirePermission('hr.bank_details.manage')
  @ApiOperation({
    operationId: 'upsertHrEmployeeBankDetails',
    summary: 'Create or replace bank details.',
  })
  @ApiOkResponse({ type: BankDetailsDto })
  upsertBankDetails(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpsertBankDetailsDto,
  ) {
    return this.bank.upsert(hrScope(ctx), id, body);
  }
}
