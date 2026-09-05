import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
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
import { FieldAgentsService, type TenantScope } from './field-agents.service.js';
import { DesignateFieldAgentRequestDto, FieldAgentDto } from './field.dto.js';

/**
 * Minimum field-agent capability management (Phase 4, ADR 0033) — a flag on
 * an existing membership, not an HR employee master.
 */
@ApiTags('field')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('field-agents')
export class FieldAgentsController {
  constructor(private readonly fieldAgents: FieldAgentsService) {}

  @Get()
  @RequirePermission('field.agents.manage')
  @ApiOperation({ operationId: 'listFieldAgents', summary: 'Field agents in the workspace.' })
  @ApiOkResponse({ type: [FieldAgentDto] })
  list(@Security() ctx: SecurityContext) {
    return this.fieldAgents.list(scope(ctx));
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('field.agents.manage')
  @ApiOperation({
    operationId: 'designateFieldAgent',
    summary: 'Designate a member as a field agent.',
  })
  @ApiOkResponse({ type: FieldAgentDto })
  designate(@Security() ctx: SecurityContext, @Body() body: DesignateFieldAgentRequestDto) {
    return this.fieldAgents.designate(scope(ctx), body.membershipId);
  }

  @Post(':membershipId/deactivate')
  @HttpCode(200)
  @RequirePermission('field.agents.manage')
  @ApiOperation({ operationId: 'deactivateFieldAgent', summary: 'Deactivate a field agent.' })
  @ApiOkResponse({ type: FieldAgentDto })
  deactivate(@Security() ctx: SecurityContext, @Param('membershipId') membershipId: string) {
    return this.fieldAgents.deactivate(scope(ctx), membershipId);
  }
}

function scope(ctx: SecurityContext): TenantScope {
  if (!ctx.tenantId) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id };
}
