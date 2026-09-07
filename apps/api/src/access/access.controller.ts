import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../admin/admin.dto.js';
import { AccessService, type TenantScope } from './access.service.js';
import {
  AccessRoleDto,
  AddPermissionSetDto,
  AssignProfileDto,
  AvailablePermissionDto,
  CreateAccessRoleDto,
  EffectiveAccessDto,
  UpdateAccessRoleDto,
} from './access.dto.js';

function scope(ctx: SecurityContext): TenantScope {
  if (!ctx.tenantId || !ctx.membership) throw new Error('no active tenant');
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

/**
 * Tenant-side access configuration (Phase 13, ADR 0042): profiles, permission
 * sets and per-member effective access. Profiles/permission sets reuse the
 * `roles.*` permission family; the effective-access read needs `access.read`.
 * Every list of offered permissions is filtered to the tenant's ENTITLED
 * modules — a workspace can never configure a permission for a module it
 * doesn't have.
 */
@ApiTags('access')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('admin')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('access/available-permissions')
  @RequirePermission('roles.read')
  @ApiOperation({
    operationId: 'listAvailablePermissions',
    summary: 'Permissions the workspace may configure (entitled modules + platform).',
  })
  @ApiOkResponse({ type: [AvailablePermissionDto] })
  available(@Security() ctx: SecurityContext) {
    return this.access.availablePermissions(scope(ctx));
  }

  // ---- profiles ------------------------------------------------

  @Get('profiles')
  @RequirePermission('roles.read')
  @ApiOperation({
    operationId: 'listProfiles',
    summary: 'Security profiles (baseline capability sets).',
  })
  @ApiOkResponse({ type: [AccessRoleDto] })
  listProfiles(@Security() ctx: SecurityContext) {
    return this.access.listRoles(scope(ctx), 'profile');
  }

  @Post('profiles')
  @HttpCode(200)
  @RequirePermission('roles.create')
  @ApiOperation({ operationId: 'createProfile', summary: 'Create a security profile.' })
  @ApiOkResponse({ type: AccessRoleDto })
  createProfile(@Security() ctx: SecurityContext, @Body() body: CreateAccessRoleDto) {
    return this.access.createRole(scope(ctx), { kind: 'profile', ...body });
  }

  @Patch('profiles/:roleId')
  @RequirePermission('roles.update')
  @ApiOperation({ operationId: 'updateProfile', summary: 'Update a security profile.' })
  @ApiOkResponse({ type: AccessRoleDto })
  updateProfile(
    @Security() ctx: SecurityContext,
    @Param('roleId') roleId: string,
    @Body() body: UpdateAccessRoleDto,
  ) {
    return this.access.updateRole(scope(ctx), roleId, body);
  }

  @Delete('profiles/:roleId')
  @HttpCode(204)
  @RequirePermission('roles.delete')
  @ApiOperation({ operationId: 'deleteProfile', summary: 'Delete an unused security profile.' })
  async deleteProfile(@Security() ctx: SecurityContext, @Param('roleId') roleId: string) {
    await this.access.deleteRole(scope(ctx), roleId);
  }

  // ---- permission sets ---------------------------------------

  @Get('permission-sets')
  @RequirePermission('roles.read')
  @ApiOperation({ operationId: 'listPermissionSets', summary: 'Additive permission sets.' })
  @ApiOkResponse({ type: [AccessRoleDto] })
  listSets(@Security() ctx: SecurityContext) {
    return this.access.listRoles(scope(ctx), 'permission_set');
  }

  @Post('permission-sets')
  @HttpCode(200)
  @RequirePermission('roles.create')
  @ApiOperation({
    operationId: 'createPermissionSet',
    summary: 'Create an additive permission set.',
  })
  @ApiOkResponse({ type: AccessRoleDto })
  createSet(@Security() ctx: SecurityContext, @Body() body: CreateAccessRoleDto) {
    return this.access.createRole(scope(ctx), { kind: 'permission_set', ...body });
  }

  @Patch('permission-sets/:roleId')
  @RequirePermission('roles.update')
  @ApiOperation({ operationId: 'updatePermissionSet', summary: 'Update a permission set.' })
  @ApiOkResponse({ type: AccessRoleDto })
  updateSet(
    @Security() ctx: SecurityContext,
    @Param('roleId') roleId: string,
    @Body() body: UpdateAccessRoleDto,
  ) {
    return this.access.updateRole(scope(ctx), roleId, body);
  }

  @Delete('permission-sets/:roleId')
  @HttpCode(204)
  @RequirePermission('roles.delete')
  @ApiOperation({ operationId: 'deletePermissionSet', summary: 'Delete an unused permission set.' })
  async deleteSet(@Security() ctx: SecurityContext, @Param('roleId') roleId: string) {
    await this.access.deleteRole(scope(ctx), roleId);
  }

  // ---- member access ---------------------------------------

  @Get('access/:membershipId')
  @RequirePermission('access.read')
  @ApiOperation({
    operationId: 'getEffectiveAccess',
    summary: 'A member’s effective access — per module, entitlement-aware, with data scope.',
  })
  @ApiOkResponse({ type: EffectiveAccessDto })
  effective(@Security() ctx: SecurityContext, @Param('membershipId') membershipId: string) {
    return this.access.effectiveAccess(scope(ctx), membershipId);
  }

  @Post('access/:membershipId/profile')
  @HttpCode(200)
  @RequirePermission('memberships.update')
  @ApiOperation({
    operationId: 'assignProfile',
    summary: 'Assign a member’s profile + data scope.',
  })
  @ApiOkResponse({ type: EffectiveAccessDto })
  assignProfile(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
    @Body() body: AssignProfileDto,
  ) {
    return this.access.assignProfile(scope(ctx), membershipId, body.roleId, body.dataScope);
  }

  @Post('access/:membershipId/permission-sets')
  @HttpCode(200)
  @RequirePermission('memberships.update')
  @ApiOperation({
    operationId: 'addMemberPermissionSet',
    summary: 'Add a permission set to a member.',
  })
  @ApiOkResponse({ type: EffectiveAccessDto })
  addSet(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
    @Body() body: AddPermissionSetDto,
  ) {
    return this.access.addPermissionSet(scope(ctx), membershipId, body.roleId);
  }

  @Delete('access/:membershipId/permission-sets/:roleId')
  @HttpCode(200)
  @RequirePermission('memberships.update')
  @ApiOperation({
    operationId: 'removeMemberPermissionSet',
    summary: 'Remove a permission set from a member.',
  })
  @ApiOkResponse({ type: EffectiveAccessDto })
  removeSet(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.access.removePermissionSet(scope(ctx), membershipId, roleId);
  }
}
