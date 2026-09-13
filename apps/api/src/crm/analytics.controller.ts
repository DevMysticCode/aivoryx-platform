import { Controller, Get, Query } from '@nestjs/common';
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
import { CrmAnalyticsService, type TenantScope } from './analytics.service.js';
import { AnalyticsOverviewQueryDto, CrmAnalyticsOverviewDto } from './analytics.dto.js';

function scope(ctx: SecurityContext): TenantScope {
  if (!ctx.tenantId || !ctx.membership) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

/**
 * Read-only CRM analytics for the dashboard and CRM overview (Phase 13D).
 * Reuses `crm.leads.read` — no separate analytics permission model. Team
 * performance is scope-gated server-side (`CrmAnalyticsService`), never just
 * hidden by the frontend.
 */
@ApiTags('crm')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('crm/analytics')
export class CrmAnalyticsController {
  constructor(private readonly analytics: CrmAnalyticsService) {}

  @Get('overview')
  @RequirePermission('crm.leads.read')
  @ApiOperation({
    operationId: 'crmAnalyticsOverview',
    summary:
      'Pipeline, trend, source, funnel, follow-up and activity analytics for the CRM dashboard.',
  })
  @ApiOkResponse({ type: CrmAnalyticsOverviewDto })
  overview(@Security() ctx: SecurityContext, @Query() query: AnalyticsOverviewQueryDto) {
    return this.analytics.overview(scope(ctx), query.days ?? 30);
  }
}
