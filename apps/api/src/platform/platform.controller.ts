import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MODULE_DEFINITIONS, PLAN_DEFINITIONS, SOLUTION_DEFINITIONS } from '@aivoryx/shared';
import { PlatformAdmin, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { PlatformService } from './platform.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import {
  ApiErrorDto,
  CreateTenantRequestDto,
  CreateTenantResponseDto,
  PlanDto,
  PlatformModuleCatalogueDto,
  PlatformOverviewDto,
  PlatformTenantDetailDto,
  PlatformTenantSummaryDto,
  SetTenantLifecycleRequestDto,
  SetTenantModuleRequestDto,
  SolutionDto,
  TenantUsageDto,
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
  constructor(
    private readonly platform: PlatformService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

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

  @Get('solutions')
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'listPlatformSolutions',
    summary:
      'Solution presets (Phase 14) — recommended module sets, not an authorization boundary.',
  })
  @ApiOkResponse({ type: [SolutionDto] })
  solutions(): SolutionDto[] {
    return SOLUTION_DEFINITIONS.map((s) => ({
      key: s.key,
      displayName: s.displayName,
      description: s.description,
      moduleKeys: [...s.moduleKeys],
    }));
  }

  @Get('plans')
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'listPlatformPlans',
    summary: 'Commercial plan catalogue (Phase 14).',
  })
  @ApiOkResponse({ type: [PlanDto] })
  plans(): PlanDto[] {
    return PLAN_DEFINITIONS.map((p) => ({
      key: p.key,
      displayName: p.displayName,
      solutionKey: p.solutionKey,
    }));
  }

  @Post('tenants')
  @HttpCode(200)
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'createPlatformTenant',
    summary:
      'Provision a new workspace: modules, TENANT_ADMIN role, subscription, and an admin invitation.',
  })
  @ApiOkResponse({ type: CreateTenantResponseDto })
  createTenant(
    @Security() ctx: SecurityContext,
    @Body() body: CreateTenantRequestDto,
  ): Promise<CreateTenantResponseDto> {
    return this.provisioning.createTenant({
      platformUserId: ctx.user.id,
      name: body.name,
      primaryContactName: body.primaryContactName,
      timezone: body.timezone,
      currency: body.currency,
      solutionKey: body.solutionKey,
      moduleKeys: body.moduleKeys,
      planKey: body.planKey,
      adminEmail: body.adminEmail,
      adminName: body.adminName,
    });
  }

  @Post('tenants/:tenantId/activate')
  @HttpCode(200)
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'activatePlatformTenant',
    summary: 'Activate a provisioning or suspended workspace.',
  })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  async activate(
    @Security() ctx: SecurityContext,
    @Param('tenantId') tenantId: string,
    @Body() body: SetTenantLifecycleRequestDto,
  ): Promise<PlatformTenantDetailDto> {
    await this.provisioning.setLifecycle({
      platformUserId: ctx.user.id,
      tenantId,
      to: 'active',
      note: body.note ?? null,
    });
    return this.platform.getTenant(ctx.user.id, tenantId);
  }

  @Post('tenants/:tenantId/suspend')
  @HttpCode(200)
  @PlatformAdmin()
  @ApiOperation({ operationId: 'suspendPlatformTenant', summary: 'Suspend an active workspace.' })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  async suspend(
    @Security() ctx: SecurityContext,
    @Param('tenantId') tenantId: string,
    @Body() body: SetTenantLifecycleRequestDto,
  ): Promise<PlatformTenantDetailDto> {
    await this.provisioning.setLifecycle({
      platformUserId: ctx.user.id,
      tenantId,
      to: 'suspended',
      note: body.note ?? null,
    });
    return this.platform.getTenant(ctx.user.id, tenantId);
  }

  @Post('tenants/:tenantId/archive')
  @HttpCode(200)
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'archivePlatformTenant',
    summary: 'Archive a workspace (terminal — no destructive deletion).',
  })
  @ApiOkResponse({ type: PlatformTenantDetailDto })
  async archive(
    @Security() ctx: SecurityContext,
    @Param('tenantId') tenantId: string,
    @Body() body: SetTenantLifecycleRequestDto,
  ): Promise<PlatformTenantDetailDto> {
    await this.provisioning.setLifecycle({
      platformUserId: ctx.user.id,
      tenantId,
      to: 'archived',
      note: body.note ?? null,
    });
    return this.platform.getTenant(ctx.user.id, tenantId);
  }

  @Get('tenants/:tenantId/usage')
  @PlatformAdmin()
  @ApiOperation({
    operationId: 'getPlatformTenantUsage',
    summary: 'Basic tenant usage — counts only, from existing data.',
  })
  @ApiOkResponse({ type: TenantUsageDto })
  usage(
    @Security() ctx: SecurityContext,
    @Param('tenantId') tenantId: string,
  ): Promise<TenantUsageDto> {
    return this.platform.usage(ctx.user.id, tenantId);
  }
}
