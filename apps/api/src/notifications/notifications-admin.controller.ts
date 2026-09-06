import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Put, Query } from '@nestjs/common';
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
import { NotificationsAdminService } from './notifications.admin.service.js';
import {
  ListDeliveriesQueryDto,
  NotificationDeliveryListDto,
  NotificationRuleDto,
  NotificationTemplateDto,
  UpdateNotificationRuleDto,
  UpdateNotificationTemplateDto,
} from './notifications.dto.js';

/**
 * Tenant notification administration (ADR 0037). Rules + templates come from the
 * code catalogue; an admin can enable/disable a rule, narrow its channels,
 * re-word a template or reset it. Not a workflow builder.
 */
@ApiTags('notifications-admin')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('admin/notifications')
export class NotificationsAdminController {
  constructor(private readonly admin: NotificationsAdminService) {}

  @Get('rules')
  @RequirePermission('notifications.manage')
  @ApiOperation({ operationId: 'listNotificationRules', summary: 'Effective notification rules.' })
  @ApiOkResponse({ type: [NotificationRuleDto] })
  listRules(@Security() ctx: SecurityContext): Promise<NotificationRuleDto[]> {
    return this.admin.listRules(scope(ctx));
  }

  @Patch('rules/:key')
  @RequirePermission('notifications.manage')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateNotificationRule',
    summary: 'Enable/disable a rule or narrow its channels.',
  })
  @ApiOkResponse({ type: [NotificationRuleDto] })
  setRule(
    @Security() ctx: SecurityContext,
    @Param('key') key: string,
    @Body() body: UpdateNotificationRuleDto,
  ): Promise<NotificationRuleDto[]> {
    return this.admin.setRule(scope(ctx), key, {
      isActive: body.isActive,
      channels: body.channels,
    });
  }

  @Get('templates')
  @RequirePermission('notifications.templates.read')
  @ApiOperation({ operationId: 'listNotificationTemplates', summary: 'Effective templates.' })
  @ApiOkResponse({ type: [NotificationTemplateDto] })
  listTemplates(@Security() ctx: SecurityContext): Promise<NotificationTemplateDto[]> {
    return this.admin.listTemplates(scope(ctx));
  }

  @Get('templates/:key')
  @RequirePermission('notifications.templates.read')
  @ApiOperation({ operationId: 'getNotificationTemplate', summary: 'One effective template.' })
  @ApiOkResponse({ type: NotificationTemplateDto })
  getTemplate(
    @Security() ctx: SecurityContext,
    @Param('key') key: string,
  ): Promise<NotificationTemplateDto> {
    return this.admin.getTemplate(scope(ctx), key);
  }

  @Put('templates/:key')
  @RequirePermission('notifications.templates.manage')
  @HttpCode(200)
  @ApiOperation({ operationId: 'updateNotificationTemplate', summary: 'Override a template.' })
  @ApiOkResponse({ type: NotificationTemplateDto })
  updateTemplate(
    @Security() ctx: SecurityContext,
    @Param('key') key: string,
    @Body() body: UpdateNotificationTemplateDto,
  ): Promise<NotificationTemplateDto> {
    return this.admin.updateTemplate(scope(ctx), key, body);
  }

  @Delete('templates/:key')
  @RequirePermission('notifications.templates.manage')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'resetNotificationTemplate',
    summary: 'Reset a template to the system default.',
  })
  @ApiOkResponse({ type: NotificationTemplateDto })
  resetTemplate(
    @Security() ctx: SecurityContext,
    @Param('key') key: string,
  ): Promise<NotificationTemplateDto> {
    return this.admin.resetTemplate(scope(ctx), key);
  }

  @Get('deliveries')
  @RequirePermission('notifications.deliveries.read')
  @ApiOperation({
    operationId: 'listNotificationDeliveries',
    summary: 'Recent notification deliveries and failures.',
  })
  @ApiOkResponse({ type: NotificationDeliveryListDto })
  listDeliveries(
    @Security() ctx: SecurityContext,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<NotificationDeliveryListDto> {
    return this.admin.listDeliveries(scope(ctx), query);
  }
}
