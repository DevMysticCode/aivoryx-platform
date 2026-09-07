import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MODULE_DEFINITIONS } from '@aivoryx/shared';
import { PlatformAdmin, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { PlatformService } from './platform.service.js';
import {
  ApiErrorDto,
  PlatformModuleCatalogueDto,
  PlatformOverviewDto,
  PlatformTenantDetailDto,
  PlatformTenantSummaryDto,
  SetTenantModuleRequestDto,
} from './platform.dto.js';

/**
 * Aivoryx **platform administration** (Phase 13, ADR 0042). Operates above
 * every tenant. Every route requires an authenticated session and a
 * `platform_admins` row (`@PlatformAdmin()`) — it does NOT require an active
 * tenant, and a tenant admin can never reach it.
 */
@ApiTags('platform')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'platformOverview',
    summary: 'Platform-level counts + module catalogue.',
  })
  @ApiOkResponse({ type: PlatformOverviewDto })
  async overview(@Security() ctx: SecurityContext): Promise<PlatformOverviewDto> {
    const tenants = await this.platform.listTenants(ctx.user.id);
    return {
      tenantCount: tenants.length,
      activeTenantCount: tenants.filter((t) => t.status === 'active').length,
      moduleCount: MODULE_DEFINITIONS.length,
      modules: MODULE_DEFINITIONS.map((m) => ({
        key: m.key,
        displayName: m.displayName,
        description: m.description,
        capabilitySummary: m.capabilitySummary,
        icon: m.icon,
        category: m.category,
        order: m.order,
        dependencies: [...m.dependencies],
        available: m.available,
      })),
    };
  }

  @Get('modules')
  @PlatformAdmin()
  @ApiOperation({ operationId: 'listPlatformModules', summary: 'The product module catalogue.' })
  @ApiOkResponse({ type: [PlatformModuleCatalogueDto] })
  modules(): PlatformModuleCatalogueDto[] {
    return MODULE_DEFINITIONS.map((m) => ({
      key: m.key,
      displayName: m.displayName,
      description: m.description,
      capabilitySummary: m.capabilitySummary,
      icon: m.icon,
      category: m.category,
      order: m.order,
      dependencies: [...m.dependencies],
      available: m.available,
    }));
  }

  @Get('tenants')
  @PlatformAdmin()
  @ApiOperation({ operationId: 'listPlatformTenants', summary: 'All workspaces.' })
  @ApiOkResponse({ type: [PlatformTenantSummaryDto] })
  listTenants(@Security() ctx: SecurityContext): Promise<PlatformTenantSummaryDto[]> {
    return this.platform.listTenants(ctx.user.id);
  }

  @Get('tenants/:tenantId')
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'getPlatformTenant',
    summary: 'One workspace with its module entitlements.',
  })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  getTenant(
    @Security() ctx: SecurityContext,
    @Param('tenantId') tenantId: string,
  ): Promise<PlatformTenantDetailDto> {
    return this.platform.getTenant(ctx.user.id, tenantId);
  }

  @Get('tenants/:tenantId/modules')
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'getPlatformTenantModules',
    summary: 'A workspace’s module entitlements.',
  })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  getTenantModules(
    @Security() ctx: SecurityContext,
    @Param('tenantId') tenantId: string,
  ): Promise<PlatformTenantDetailDto> {
    return this.platform.getTenant(ctx.user.id, tenantId);
  }

  @Put('tenants/:tenantId/modules/:moduleKey')
  @HttpCode(200)
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'setPlatformTenantModule',
    summary: 'Enable or disable a module for a workspace (dependency-checked).',
  })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  setTenantModule(
    @Security() ctx: SecurityContext,
    @Param('tenantId') tenantId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: SetTenantModuleRequestDto,
  ): Promise<PlatformTenantDetailDto> {
    return this.platform.setModule({
      platformUserId: ctx.user.id,
      tenantId,
      moduleKey,
      state: body.state,
      note: body.note ?? null,
    });
  }
}
