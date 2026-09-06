import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CHANNELS = ['in_app', 'email', 'whatsapp', 'sms'] as const;
const TYPES = ['info', 'success', 'warning', 'action_required'] as const;
const DELIVERY_STATUSES = ['pending', 'processing', 'sent', 'failed', 'cancelled'] as const;

// ---- user: notifications --------------------------------------------

export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: TYPES }) type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true, type: String }) deepLink!: string | null;
  @ApiProperty({ nullable: true, type: String }) sourceEventType!: string | null;
  @ApiProperty() read!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) readAt!: string | null;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() unread!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class UnreadCountDto {
  @ApiProperty() unread!: number;
}

export class MarkAllReadResultDto {
  @ApiProperty() updated!: number;
}

export class ListNotificationsQueryDto {
  @ApiProperty({ required: false, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiProperty({ required: false, type: Boolean })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;
}

// ---- user: preferences --------------------------------------------

export class NotificationPreferencesDto {
  @ApiProperty() inAppEnabled!: boolean;
  @ApiProperty() emailEnabled!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty() @IsBoolean() inAppEnabled!: boolean;
  @ApiProperty() @IsBoolean() emailEnabled!: boolean;
}

// ---- admin: rules -----------------------------------------------

export class NotificationRuleDto {
  @ApiProperty() key!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty() templateKey!: string;
  @ApiProperty({ enum: CHANNELS, isArray: true }) channels!: string[];
  @ApiProperty({ enum: CHANNELS, isArray: true, description: 'All channels the default supports.' })
  availableChannels!: string[];
  @ApiProperty({ enum: ['USER', 'ACTOR', 'ASSIGNED_USER', 'ROLE', 'CUSTOMER'] })
  recipientStrategy!: string;
  @ApiProperty({ enum: TYPES }) notificationType!: string;
  @ApiProperty() suppressible!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() overridden!: boolean;
  @ApiProperty() description!: string;
}

export class UpdateNotificationRuleDto {
  @ApiProperty({ required: false, type: Boolean })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, enum: CHANNELS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CHANNELS as unknown as string[], { each: true })
  channels?: string[];
}

// ---- admin: templates -----------------------------------------

export class NotificationTemplateChannelDto {
  @ApiProperty({ enum: CHANNELS }) channel!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true, type: String }) emailSubject!: string | null;
  @ApiProperty({ nullable: true, type: String }) emailBody!: string | null;
  @ApiProperty() overridden!: boolean;
}

export class NotificationTemplateDto {
  @ApiProperty() key!: string;
  @ApiProperty({ type: [String] }) variables!: string[];
  @ApiProperty({ type: [NotificationTemplateChannelDto] })
  channels!: NotificationTemplateChannelDto[];
  @ApiProperty() overridden!: boolean;
}

export class UpdateNotificationTemplateDto {
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MaxLength(2000) body!: string;
  @ApiProperty() @IsString() @MaxLength(300) emailSubject!: string;
  @ApiProperty() @IsString() @MaxLength(5000) emailBody!: string;
}

// ---- admin: deliveries --------------------------------------

export class NotificationDeliveryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) notificationId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: TYPES }) type!: string;
  @ApiProperty({ nullable: true, type: String }) sourceEventType!: string | null;
  @ApiProperty({ nullable: true, type: String }) ruleKey!: string | null;
  @ApiProperty({ enum: CHANNELS }) channel!: string;
  @ApiProperty() recipientRef!: string;
  @ApiProperty({ nullable: true, type: String }) provider!: string | null;
  @ApiProperty({ enum: DELIVERY_STATUSES }) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty() maxAttempts!: number;
  @ApiProperty({ nullable: true, type: String }) failureCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) failureMessage!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerMessageId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastAttemptAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) sentAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationDeliveryListDto {
  @ApiProperty({ type: [NotificationDeliveryDto] }) items!: NotificationDeliveryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListDeliveriesQueryDto {
  @ApiProperty({ required: false, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiProperty({ required: false, enum: DELIVERY_STATUSES })
  @IsOptional()
  @IsIn(DELIVERY_STATUSES as unknown as string[])
  status?: string;
}
