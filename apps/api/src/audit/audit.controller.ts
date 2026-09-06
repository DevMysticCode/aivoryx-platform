import { Controller, Get, Param, Query } from '@nestjs/common';
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
import { scope } from '../supply/common.js';
import { AuditQueryService } from './audit.query.service.js';
import { AuditLogDetailDto, AuditLogListDto, ListAuditQueryDto } from './audit.dto.js';

/**
 * Read-only Global Audit Log API (Phase 11, ADR 0040). `audit.read` only —
 * there is deliberately no create / update / delete endpoint. Tenant is
 * server-derived; RLS scopes every result to the caller's workspace.
 */
@ApiTags('audit')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.read')
  @ApiOperation({ operationId: 'listAuditLog', summary: 'Search the workspace audit log.' })
  @ApiOkResponse({ type: AuditLogListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListAuditQueryDto) {
    return this.audit.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('audit.read')
  @ApiOperation({ operationId: 'getAuditLogEntry', summary: 'One audit entry with safe detail.' })
  @ApiOkResponse({ type: AuditLogDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.audit.get(scope(ctx), id);
  }
}
