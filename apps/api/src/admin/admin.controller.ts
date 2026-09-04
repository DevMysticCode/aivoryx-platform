import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { RequirePermission } from '../security/security.decorators.js';
import { Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { AdminService } from './admin.service.js';
import { AdminMembershipDto, AdminRoleDto, CataloguePermissionDto } from './admin.dto.js';

/**
 * Minimal read-only platform-security administration surface. It exists to
 * exercise `@RequirePermission` + RLS end to end; it is NOT business/admin UI.
 */
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('memberships')
  @RequirePermission('memberships.read')
  @ApiOperation({ operationId: 'listMemberships', summary: 'Memberships in the active workspace.' })
  @ApiOkResponse({ type: [AdminMembershipDto] })
  listMemberships(@Security() ctx: SecurityContext): Promise<AdminMembershipDto[]> {
    return this.admin.listMemberships(tenantScope(ctx));
  }

  @Get('roles')
  @RequirePermission('roles.read')
  @ApiOperation({ operationId: 'listRoles', summary: 'Roles in the active workspace.' })
  @ApiOkResponse({ type: [AdminRoleDto] })
  listRoles(@Security() ctx: SecurityContext): Promise<AdminRoleDto[]> {
    return this.admin.listRoles(tenantScope(ctx));
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

function tenantScope(ctx: SecurityContext): { tenantId: string; userId: string } {
  if (!ctx.tenantId) {
    // Unreachable: @RequirePermission implies a resolved tenant. Defensive only.
    throw new AppError('AUTH_NO_ACTIVE_TENANT');
  }
  return { tenantId: ctx.tenantId, userId: ctx.user.id };
}
