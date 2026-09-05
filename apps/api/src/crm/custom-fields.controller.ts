import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
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
import { CustomFieldsService } from './custom-fields.service.js';
import { CreateCustomFieldRequestDto, CustomFieldDefinitionDto } from './crm.dto.js';

/**
 * Generic tenant custom fields for the `lead` entity (ADR 0031). Definition
 * management reuses `crm.leads.update` — there is deliberately no dedicated
 * "manage custom fields" permission for this small a surface.
 */
@ApiTags('crm')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('crm/custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFields: CustomFieldsService) {}

  @Get()
  @RequirePermission('crm.leads.read')
  @ApiOperation({ operationId: 'listCustomFields', summary: 'Lead custom field definitions.' })
  @ApiOkResponse({ type: [CustomFieldDefinitionDto] })
  list(@Security() ctx: SecurityContext) {
    return this.customFields.list(scope(ctx));
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('crm.leads.update')
  @ApiOperation({ operationId: 'createCustomField', summary: 'Define a new lead custom field.' })
  @ApiOkResponse({ type: CustomFieldDefinitionDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateCustomFieldRequestDto) {
    return this.customFields.create(scope(ctx), body);
  }

  @Patch(':definitionId/deprecate')
  @RequirePermission('crm.leads.update')
  @ApiOperation({ operationId: 'deprecateCustomField', summary: 'Retire a lead custom field.' })
  @ApiOkResponse({ type: CustomFieldDefinitionDto })
  deprecate(@Security() ctx: SecurityContext, @Param('definitionId') definitionId: string) {
    return this.customFields.deprecate(scope(ctx), definitionId);
  }
}

function scope(ctx: SecurityContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id };
}
