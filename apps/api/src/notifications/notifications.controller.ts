import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthOnly, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { scope } from '../supply/common.js';
import { NotificationsUserService } from './notifications.user.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import {
  ListNotificationsQueryDto,
  MarkAllReadResultDto,
  NotificationListDto,
  NotificationPreferencesDto,
  UnreadCountDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto.js';

/**
 * The signed-in user's notification inbox + preferences (ADR 0037). No
 * permission key: every endpoint is hard-scoped to the caller's own membership
 * (and RLS to their tenant), so any authenticated member may use their own
 * bell and settings. An active tenant is required.
 */
@ApiTags('notifications')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsUserService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Get()
  @AuthOnly()
  @ApiOperation({ operationId: 'listNotifications', summary: 'List my notifications.' })
  @ApiOkResponse({ type: NotificationListDto })
  list(
    @Security() ctx: SecurityContext,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListDto> {
    return this.notifications.list(scope(ctx), query);
  }

  @Get('unread-count')
  @AuthOnly()
  @ApiOperation({
    operationId: 'notificationUnreadCount',
    summary: 'My unread notification count.',
  })
  @ApiOkResponse({ type: UnreadCountDto })
  async unreadCount(@Security() ctx: SecurityContext): Promise<UnreadCountDto> {
    return { unread: await this.notifications.unreadCount(scope(ctx)) };
  }

  @Post(':id/read')
  @AuthOnly()
  @HttpCode(200)
  @ApiOperation({ operationId: 'markNotificationRead', summary: 'Mark one notification read.' })
  @ApiOkResponse({ type: UnreadCountDto })
  async markRead(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
  ): Promise<UnreadCountDto> {
    const s = scope(ctx);
    await this.notifications.markRead(s, id);
    return { unread: await this.notifications.unreadCount(s) };
  }

  @Post('read-all')
  @AuthOnly()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'markAllNotificationsRead',
    summary: 'Mark all my notifications read.',
  })
  @ApiOkResponse({ type: MarkAllReadResultDto })
  async markAllRead(@Security() ctx: SecurityContext): Promise<MarkAllReadResultDto> {
    return { updated: await this.notifications.markAllRead(scope(ctx)) };
  }

  @Get('preferences')
  @AuthOnly()
  @ApiOperation({
    operationId: 'getNotificationPreferences',
    summary: 'My notification preferences.',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  getPreferences(@Security() ctx: SecurityContext): Promise<NotificationPreferencesDto> {
    return this.preferences.get(scope(ctx));
  }

  @Put('preferences')
  @AuthOnly()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateNotificationPreferences',
    summary: 'Update my notification preferences.',
  })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  updatePreferences(
    @Security() ctx: SecurityContext,
    @Body() body: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    return this.preferences.update(scope(ctx), {
      inAppEnabled: body.inAppEnabled,
      emailEnabled: body.emailEnabled,
    });
  }
}
