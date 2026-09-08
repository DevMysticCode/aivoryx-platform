import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags, ApiForbiddenResponse } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { SavedViewsService, type SavedViewScope } from './saved-views.service.js';

export class SavedViewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: Object, additionalProperties: true })
  config!: Record<string, unknown>;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class CreateSavedViewDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty({ type: Object, additionalProperties: true })
  @IsObject()
  config!: Record<string, unknown>;
}

export class UpdateSavedViewDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;
  @ApiProperty({ required: false, type: Object, additionalProperties: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

function scope(ctx: SecurityContext): SavedViewScope {
  if (!ctx.tenantId || !ctx.membership) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

/**
 * Persistent CRM lead-list saved views (Phase 13C). Owned per membership; every
 * route is gated by `crm.leads.read` and RLS-scoped to the active tenant.
 */
@ApiTags('crm')
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('crm/saved-views')
export class SavedViewsController {
  constructor(private readonly views: SavedViewsService) {}

  @Get()
  @RequirePermission('crm.leads.read')
  @ApiOperation({ operationId: 'listSavedViews', summary: 'The caller’s CRM saved views.' })
  @ApiOkResponse({ type: [SavedViewDto] })
  list(@Security() ctx: SecurityContext) {
    return this.views.list(scope(ctx));
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('crm.leads.read')
  @ApiOperation({ operationId: 'createSavedView', summary: 'Save a lead-list view.' })
  @ApiOkResponse({ type: SavedViewDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateSavedViewDto) {
    return this.views.create(scope(ctx), { name: body.name, config: body.config });
  }

  @Patch(':id')
  @RequirePermission('crm.leads.read')
  @ApiOperation({ operationId: 'updateSavedView', summary: 'Rename or re-scope a saved view.' })
  @ApiOkResponse({ type: SavedViewDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateSavedViewDto,
  ) {
    return this.views.update(scope(ctx), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('crm.leads.read')
  @ApiOperation({ operationId: 'deleteSavedView', summary: 'Delete a saved view.' })
  async remove(@Security() ctx: SecurityContext, @Param('id') id: string) {
    await this.views.remove(scope(ctx), id);
  }
}
