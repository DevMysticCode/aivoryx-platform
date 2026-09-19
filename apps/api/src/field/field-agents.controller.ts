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
import { WorkforceDirectoryService } from '../hr/workforce-directory.service.js';
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
  constructor(
    private readonly fieldAgents: FieldAgentsService,
    private readonly workforce: WorkforceDirectoryService,
  ) {}

  @Get()
  @RequirePermission('field.agents.manage')
  @ApiOperation({ operationId: 'listFieldAgents', summary: 'Field agents in the workspace.' })
  @ApiOkResponse({ type: [FieldAgentDto] })
  async list(@Security() ctx: SecurityContext) {
    const agents = await this.fieldAgents.list(scope(ctx));
    // Optional HR link (Phase 17): only when the workspace has HR AND the caller
    // may read employees. Field never reads HR tables — it asks HR's directory.
    const canSeeEmployees =
      ctx.entitledModules.has('HR') && ctx.permissions.has('hr.employee.read') && !!ctx.membership;
    if (!canSeeEmployees || agents.length === 0) return agents;
    const linked = await this.workforce.linkedByMembership(
      { tenantId: ctx.tenantId!, userId: ctx.user.id, actorMembershipId: ctx.membership!.id },
      agents.map((a) => a.membershipId),
    );
    return agents.map((a) => ({ ...a, employee: linked.get(a.membershipId) ?? null }));
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
