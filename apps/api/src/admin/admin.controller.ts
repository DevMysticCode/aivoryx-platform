import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
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
import { AdminService } from './admin.service.js';
import { MembersService } from './members.service.js';
import { TenantService } from './tenant.service.js';
import {
  AdminRoleDto,
  ApiErrorDto,
  AssignRoleRequestDto,
  CataloguePermissionDto,
  InviteMemberRequestDto,
  InviteMemberResponseDto,
  MemberDto,
  TenantDto,
  UpdateMemberRequestDto,
  UpdateTenantRequestDto,
} from './admin.dto.js';

/**
 * Tenant administration & user lifecycle (ADR 0030). Every route requires an
 * authenticated session, an active membership, and a specific permission; the
 * data layer is additionally RLS-scoped to the active tenant.
 */
@ApiTags('admin')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly tenants: TenantService,
    private readonly members: MembersService,
  ) {}

  // ---- tenant ---------------------------------------------------------

  @Get('tenant')
  @RequirePermission('tenants.read')
  @ApiOperation({ operationId: 'getTenant', summary: 'The current workspace.' })
  @ApiOkResponse({ type: TenantDto })
  getTenant(@Security() ctx: SecurityContext): Promise<TenantDto> {
    return this.tenants.get(scope(ctx));
  }

  @Patch('tenant')
  @RequirePermission('tenants.update')
  @ApiOperation({ operationId: 'updateTenant', summary: 'Edit the current workspace.' })
  @ApiOkResponse({ type: TenantDto })
  updateTenant(
    @Security() ctx: SecurityContext,
    @Body() body: UpdateTenantRequestDto,
  ): Promise<TenantDto> {
    return this.tenants.update(scope(ctx), { name: body.name });
  }

  // ---- members ------------------------------------------------------

  @Get('members')
  @RequirePermission('memberships.read')
  @ApiOperation({ operationId: 'listMembers', summary: 'Members of the current workspace.' })
  @ApiOkResponse({ type: [MemberDto] })
  listMembers(@Security() ctx: SecurityContext): Promise<MemberDto[]> {
    return this.members.list(scope(ctx));
  }

  @Get('members/:membershipId')
  @RequirePermission('memberships.read')
  @ApiOperation({ operationId: 'getMember', summary: 'A single member.' })
  @ApiOkResponse({ type: MemberDto })
  getMember(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
  ): Promise<MemberDto> {
    return this.members.get(scope(ctx), membershipId);
  }

  @Post('members')
  @RequirePermission('users.create')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'inviteMember',
    summary: 'Invite a person into the workspace. Returns a one-time invitation token.',
  })
  @ApiOkResponse({ type: InviteMemberResponseDto })
  inviteMember(
    @Security() ctx: SecurityContext,
    @Body() body: InviteMemberRequestDto,
  ): Promise<InviteMemberResponseDto> {
    return this.members.invite(scope(ctx), {
      email: body.email,
      name: body.name,
      roleKeys: body.roleKeys,
    });
  }

  @Patch('members/:membershipId')
  @RequirePermission('memberships.update')
  @ApiOperation({ operationId: 'updateMember', summary: 'Suspend or reactivate a membership.' })
  @ApiOkResponse({ type: MemberDto })
  updateMember(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
    @Body() body: UpdateMemberRequestDto,
  ): Promise<MemberDto> {
    return this.members.setStatus(scope(ctx), membershipId, body.status);
  }

  @Delete('members/:membershipId')
  @RequirePermission('users.delete')
  @HttpCode(204)
  @ApiOperation({ operationId: 'removeMember', summary: 'Remove a membership from the workspace.' })
  async removeMember(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
  ): Promise<void> {
    await this.members.remove(scope(ctx), membershipId);
  }

  // ---- member roles ----------------------------------------------

  @Post('members/:membershipId/roles')
  @RequirePermission('memberships.update')
  @HttpCode(200)
  @ApiOperation({ operationId: 'assignMemberRole', summary: 'Assign a generic role to a member.' })
  @ApiOkResponse({ type: MemberDto })
  assignRole(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
    @Body() body: AssignRoleRequestDto,
  ): Promise<MemberDto> {
    return this.members.assignRole(scope(ctx), membershipId, body.roleKey);
  }

  @Delete('members/:membershipId/roles/:roleKey')
  @RequirePermission('memberships.update')
  @ApiOperation({ operationId: 'removeMemberRole', summary: 'Remove a role from a member.' })
  @ApiOkResponse({ type: MemberDto })
  removeRole(
    @Security() ctx: SecurityContext,
    @Param('membershipId') membershipId: string,
    @Param('roleKey') roleKey: string,
  ): Promise<MemberDto> {
    return this.members.removeRole(scope(ctx), membershipId, roleKey);
  }

  // ---- roles & catalogue --------------------------------------

  @Get('roles')
  @RequirePermission('roles.read')
  @ApiOperation({ operationId: 'listRoles', summary: 'Generic roles available in the workspace.' })
  @ApiOkResponse({ type: [AdminRoleDto] })
  listRoles(@Security() ctx: SecurityContext): Promise<AdminRoleDto[]> {
    return this.admin.listRoles(scope(ctx));
  }

  @Get('permissions')
  @RequirePermission('permissions.read')
  @ApiOperation({
    operationId: 'listCataloguePermissions',
    summary: 'The global permission catalogue.',
  })
  @ApiOkResponse({ type: [CataloguePermissionDto] })
  listPermissions(): CataloguePermissionDto[] {
    return this.admin.listCataloguePermissions();
  }
}

function scope(ctx: SecurityContext): {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
} {
  if (!ctx.tenantId || !ctx.membership) {
    // Unreachable: @RequirePermission implies a resolved tenant. Defensive only.
    throw new AppError('AUTH_NO_ACTIVE_TENANT');
  }
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}
