import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
import { ProjectsService } from './projects.service.js';
import { scope } from './common.js';
import {
  AllocateMaterialDto,
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectActivityDto,
  ProjectDetailDto,
  ProjectListDto,
  ProjectMaterialDto,
  SetProjectStatusDto,
  UpdateMaterialDto,
  UpsertMaterialDto,
} from './projects.dto.js';

/**
 * Projects/orders — the CRM ↔ operations bridge (Phase 5, ADR 0034).
 */
@ApiTags('projects')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('projects.read')
  @ApiOperation({ operationId: 'listProjects', summary: 'Search and filter projects.' })
  @ApiOkResponse({ type: ProjectListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListProjectsQueryDto) {
    return this.projects.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('projects.read')
  @ApiOperation({ operationId: 'getProject', summary: 'A project with its material requirements.' })
  @ApiOkResponse({ type: ProjectDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.projects.get(scope(ctx), id);
  }

  @Get(':id/activities')
  @RequirePermission('projects.read')
  @ApiOperation({ operationId: 'listProjectActivities', summary: 'The project timeline.' })
  @ApiOkResponse({ type: [ProjectActivityDto] })
  activities(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.projects.listActivities(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('projects.create')
  @ApiOperation({ operationId: 'createProject', summary: 'Create a project from a CRM lead.' })
  @ApiOkResponse({ type: ProjectDetailDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateProjectDto) {
    return this.projects.create(scope(ctx), body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('projects.approve')
  @ApiOperation({ operationId: 'approveProject', summary: 'Approve a draft project.' })
  @ApiOkResponse({ type: ProjectDetailDto })
  approve(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.projects.approve(scope(ctx), id);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('projects.update')
  @ApiOperation({ operationId: 'setProjectStatus', summary: 'Move a project to a new status.' })
  @ApiOkResponse({ type: ProjectDetailDto })
  setStatus(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: SetProjectStatusDto,
  ) {
    return this.projects.setStatus(scope(ctx), id, body.status);
  }

  // ---- materials ----

  @Post(':id/materials')
  @HttpCode(200)
  @RequirePermission('projects.update')
  @ApiOperation({
    operationId: 'addProjectMaterial',
    summary: 'Add or update a material requirement.',
  })
  @ApiOkResponse({ type: [ProjectMaterialDto] })
  addMaterial(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpsertMaterialDto,
  ) {
    return this.projects.addMaterial(scope(ctx), id, body);
  }

  @Patch(':id/materials/:materialId')
  @RequirePermission('projects.update')
  @ApiOperation({ operationId: 'updateProjectMaterial', summary: 'Edit a material requirement.' })
  @ApiOkResponse({ type: [ProjectMaterialDto] })
  updateMaterial(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Param('materialId') materialId: string,
    @Body() body: UpdateMaterialDto,
  ) {
    return this.projects.updateMaterial(scope(ctx), id, materialId, body);
  }

  @Delete(':id/materials/:materialId')
  @RequirePermission('projects.update')
  @ApiOperation({
    operationId: 'removeProjectMaterial',
    summary: 'Remove an unallocated material.',
  })
  @ApiOkResponse({ type: [ProjectMaterialDto] })
  removeMaterial(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Param('materialId') materialId: string,
  ) {
    return this.projects.removeMaterial(scope(ctx), id, materialId);
  }

  // ---- allocation ----

  @Post(':id/materials/allocate')
  @HttpCode(200)
  @RequirePermission('inventory.allocate')
  @ApiOperation({
    operationId: 'allocateMaterial',
    summary: 'Allocate warehouse stock to the project.',
  })
  @ApiOkResponse({ type: ProjectDetailDto })
  allocate(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: AllocateMaterialDto,
  ) {
    return this.projects.allocate(scope(ctx), id, body);
  }

  @Post(':id/materials/release')
  @HttpCode(200)
  @RequirePermission('inventory.allocate')
  @ApiOperation({ operationId: 'releaseMaterial', summary: 'Release a previous allocation.' })
  @ApiOkResponse({ type: ProjectDetailDto })
  release(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: AllocateMaterialDto,
  ) {
    return this.projects.release(scope(ctx), id, body);
  }
}
