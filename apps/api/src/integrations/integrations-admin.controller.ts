import { Controller, Body, Get, HttpCode, Param, Post } from '@nestjs/common';
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
import { IngestionService } from './ingestion.service.js';
import { SourcesService } from './sources.service.js';
import {
  CanonicalEventDto,
  CreateSourceRequestDto,
  CreateSourceResponseDto,
  SourceDto,
} from './integrations.dto.js';

/**
 * Admin surface for the inbound connector (ADR 0032). Every route requires
 * `crm.integrations.manage` and is RLS-scoped to the active tenant.
 */
@ApiTags('admin')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('admin/integrations')
export class IntegrationsAdminController {
  constructor(
    private readonly sources: SourcesService,
    private readonly ingestion: IngestionService,
  ) {}

  // ---- sources --------------------------------------------------------

  @Get('sources')
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({ operationId: 'listSources', summary: 'Configured inbound lead sources.' })
  @ApiOkResponse({ type: [SourceDto] })
  list(@Security() ctx: SecurityContext) {
    return this.sources.list(scope(ctx));
  }

  @Post('sources')
  @HttpCode(200)
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({
    operationId: 'createSource',
    summary: 'Configure a new Pabbly connector source. Returns a one-time secret.',
  })
  @ApiOkResponse({ type: CreateSourceResponseDto })
  async create(@Security() ctx: SecurityContext, @Body() body: CreateSourceRequestDto) {
    const { source, secret } = await this.sources.create(scope(ctx), body);
    return { source, credential: { secret } };
  }

  @Post('sources/:sourceId/rotate-secret')
  @HttpCode(200)
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({
    operationId: 'rotateSourceSecret',
    summary: 'Issue a new secret; the old one stops working.',
  })
  @ApiOkResponse({ type: CreateSourceResponseDto })
  async rotate(@Security() ctx: SecurityContext, @Param('sourceId') sourceId: string) {
    const { source, secret } = await this.sources.rotateSecret(scope(ctx), sourceId);
    return { source, credential: { secret } };
  }

  @Post('sources/:sourceId/revoke')
  @HttpCode(200)
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({
    operationId: 'revokeSource',
    summary: 'Revoke a source — it can no longer ingest.',
  })
  @ApiOkResponse({ type: SourceDto })
  revoke(@Security() ctx: SecurityContext, @Param('sourceId') sourceId: string) {
    return this.sources.revoke(scope(ctx), sourceId);
  }

  @Post('sources/:sourceId/reactivate')
  @HttpCode(200)
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({
    operationId: 'reactivateSource',
    summary: 'Reactivate a previously revoked source.',
  })
  @ApiOkResponse({ type: SourceDto })
  reactivate(@Security() ctx: SecurityContext, @Param('sourceId') sourceId: string) {
    return this.sources.reactivate(scope(ctx), sourceId);
  }

  // ---- inbound events -----------------------------------------------

  @Get('events')
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({ operationId: 'listInboundEvents', summary: 'Recent inbound lead events.' })
  @ApiOkResponse({ type: [CanonicalEventDto] })
  async listEvents(@Security() ctx: SecurityContext) {
    const rows = await this.sources.listRecentEvents(scope(ctx));
    return rows.map((r) => ({
      id: r.id,
      rawEventId: r.rawEventId,
      sourceId: r.sourceId,
      status: r.status,
      leadId: r.leadId,
      dedupeOutcome: r.dedupeOutcome,
      processingAttempts: r.processingAttempts,
      lastErrorCode: r.lastErrorCode,
      lastErrorMessage: r.lastErrorMessage,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  @Get('events/:id')
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({
    operationId: 'getInboundEvent',
    summary: 'One inbound event, its raw payload, and its stage log.',
  })
  getEvent(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.sources.getEventDetail(scope(ctx), id);
  }

  @Post('events/:id/replay')
  @HttpCode(200)
  @RequirePermission('crm.integrations.manage')
  @ApiOperation({
    operationId: 'replayInboundEvent',
    summary: 'Re-run the pipeline for a failed inbound event.',
  })
  replay(@Security() ctx: SecurityContext, @Param('id') id: string) {
    const tenantId = requireTenant(ctx);
    return this.ingestion.replay(tenantId, id, ctx.membership?.id ?? null);
  }
}

function scope(ctx: SecurityContext): {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
} {
  if (!ctx.tenantId || !ctx.membership) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

function requireTenant(ctx: SecurityContext): string {
  if (!ctx.tenantId) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return ctx.tenantId;
}
