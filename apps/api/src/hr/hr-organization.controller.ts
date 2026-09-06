import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { hrScope } from './common.js';
import { OrganizationService } from './organization.service.js';
import { DashboardService } from './dashboard.service.js';
import {
  CreateOrgUnitDto,
  CreateWorkLocationDto,
  CreateWorkScheduleDto,
  HrDashboardDto,
  OrgChartDto,
  OrgUnitDto,
  UpdateOrgUnitDto,
  WorkLocationDto,
  WorkScheduleDto,
} from './hr.dto.js';

/**
 * HR organisation structure (Phase 12, ADR 0041): departments, designations,
 * work locations, schedules and the derived org chart. All tenant-configurable
 * — nothing is hardcoded. Reads need `hr.organization.read`, writes
 * `hr.organization.manage`.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr')
export class HrOrganizationController {
  constructor(
    private readonly org: OrganizationService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('dashboard')
  @RequirePermission('hr.employee.read')
  @ApiOperation({ operationId: 'hrDashboard', summary: 'HR dashboard counters.' })
  @ApiOkResponse({ type: HrDashboardDto })
  getDashboard(@Security() ctx: SecurityContext) {
    return this.dashboard.summary(hrScope(ctx));
  }

  // ---- departments ----------------------------------

  @Get('departments')
  @RequirePermission('hr.organization.read')
  @ApiOperation({ operationId: 'listHrDepartments', summary: 'List departments.' })
  @ApiOkResponse({ type: [OrgUnitDto] })
  listDepartments(@Security() ctx: SecurityContext) {
    return this.org.listDepartments(hrScope(ctx));
  }

  @Post('departments')
  @HttpCode(200)
  @RequirePermission('hr.organization.manage')
  @ApiOperation({ operationId: 'createHrDepartment', summary: 'Create a department.' })
  @ApiOkResponse({ type: OrgUnitDto })
  createDepartment(@Security() ctx: SecurityContext, @Body() body: CreateOrgUnitDto) {
    return this.org.createDepartment(hrScope(ctx), body);
  }

  @Patch('departments/:id')
  @RequirePermission('hr.organization.manage')
  @ApiOperation({ operationId: 'updateHrDepartment', summary: 'Update a department.' })
  @ApiOkResponse({ type: OrgUnitDto })
  updateDepartment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateOrgUnitDto,
  ) {
    return this.org.updateDepartment(hrScope(ctx), id, body);
  }

  // ---- designations --------------------------------

  @Get('designations')
  @RequirePermission('hr.organization.read')
  @ApiOperation({ operationId: 'listHrDesignations', summary: 'List designations.' })
  @ApiOkResponse({ type: [OrgUnitDto] })
  listDesignations(@Security() ctx: SecurityContext) {
    return this.org.listDesignations(hrScope(ctx));
  }

  @Post('designations')
  @HttpCode(200)
  @RequirePermission('hr.organization.manage')
  @ApiOperation({ operationId: 'createHrDesignation', summary: 'Create a designation.' })
  @ApiOkResponse({ type: OrgUnitDto })
  createDesignation(@Security() ctx: SecurityContext, @Body() body: CreateOrgUnitDto) {
    return this.org.createDesignation(hrScope(ctx), body);
  }

  @Patch('designations/:id')
  @RequirePermission('hr.organization.manage')
  @ApiOperation({ operationId: 'updateHrDesignation', summary: 'Update a designation.' })
  @ApiOkResponse({ type: OrgUnitDto })
  updateDesignation(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateOrgUnitDto,
  ) {
    return this.org.updateDesignation(hrScope(ctx), id, body);
  }

  // ---- work locations -----------------------------

  @Get('locations')
  @RequirePermission('hr.organization.read')
  @ApiOperation({ operationId: 'listHrLocations', summary: 'List work locations.' })
  @ApiOkResponse({ type: [WorkLocationDto] })
  listLocations(@Security() ctx: SecurityContext) {
    return this.org.listLocations(hrScope(ctx));
  }

  @Post('locations')
  @HttpCode(200)
  @RequirePermission('hr.organization.manage')
  @ApiOperation({ operationId: 'createHrLocation', summary: 'Create a work location.' })
  @ApiOkResponse({ type: WorkLocationDto })
  createLocation(@Security() ctx: SecurityContext, @Body() body: CreateWorkLocationDto) {
    return this.org.createLocation(hrScope(ctx), body);
  }

  @Patch('locations/:id')
  @RequirePermission('hr.organization.manage')
  @ApiOperation({ operationId: 'updateHrLocation', summary: 'Update a work location.' })
  @ApiOkResponse({ type: WorkLocationDto })
  updateLocation(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateOrgUnitDto,
  ) {
    return this.org.updateLocation(hrScope(ctx), id, body);
  }

  // ---- schedules ----------------------------------

  @Get('schedules')
  @RequirePermission('hr.organization.read')
  @ApiOperation({ operationId: 'listHrSchedules', summary: 'List work schedules.' })
  @ApiOkResponse({ type: [WorkScheduleDto] })
  listSchedules(@Security() ctx: SecurityContext) {
    return this.org.listSchedules(hrScope(ctx));
  }

  @Post('schedules')
  @HttpCode(200)
  @RequirePermission('hr.organization.manage')
  @ApiOperation({ operationId: 'createHrSchedule', summary: 'Create a work schedule.' })
  @ApiOkResponse({ type: WorkScheduleDto })
  createSchedule(@Security() ctx: SecurityContext, @Body() body: CreateWorkScheduleDto) {
    return this.org.createSchedule(hrScope(ctx), body);
  }

  // ---- org chart ----------------------------------

  @Get('organization/chart')
  @RequirePermission('hr.organization.read')
  @ApiOperation({ operationId: 'hrOrgChart', summary: 'The reporting hierarchy.' })
  @ApiOkResponse({ type: OrgChartDto })
  orgChart(@Security() ctx: SecurityContext) {
    return this.org.orgChart(hrScope(ctx));
  }
}
