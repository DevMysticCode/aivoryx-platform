import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { AUDIT_ACTIONS, AUDIT_MODULES } from './audit.actions.js';

/** One audit entry as returned by the read API (never the raw DB row). */
export class AuditLogDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ enum: ['USER', 'SYSTEM'] }) actorType!: 'USER' | 'SYSTEM';
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  actorMembershipId!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Display name of the actor membership.',
  })
  actorName!: string | null;
  @ApiProperty({ nullable: true, type: String })
  actorEmail!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Subsystem, for SYSTEM actors.' })
  actorSource!: string | null;
  @ApiProperty({ example: 'finance.invoice.issued' }) action!: string;
  @ApiProperty({ enum: AUDIT_MODULES }) module!: string;
  @ApiProperty({ example: 'invoice' }) entityType!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) entityId!: string | null;
  @ApiProperty({ nullable: true, type: String }) correlationId!: string | null;
}

export class AuditLogDetailDto extends AuditLogDto {
  @ApiProperty({ nullable: true, type: String }) requestId!: string | null;
  @ApiProperty({ nullable: true, type: String }) ipAddress!: string | null;
  @ApiProperty({ nullable: true, type: String }) userAgent!: string | null;
  @ApiProperty({ type: Object, description: 'Sanitised key/value context.' })
  metadata!: Record<string, unknown>;
  @ApiProperty({
    nullable: true,
    type: Object,
    description: 'Sanitised before/after for approved fields: `{ field: { from, to } }`.',
  })
  changes!: Record<string, { from: unknown; to: unknown }> | null;
}

export class AuditLogListDto {
  @ApiProperty({ type: [AuditLogDto] }) items!: AuditLogDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListAuditQueryDto {
  @ApiPropertyOptional({ description: 'ISO-8601. Only entries at/after this instant.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO-8601. Only entries strictly before this instant.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorMembershipId?: string;

  @ApiPropertyOptional({ enum: ['USER', 'SYSTEM'] })
  @IsOptional()
  @IsIn(['USER', 'SYSTEM'])
  actorType?: 'USER' | 'SYSTEM';

  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  @IsOptional()
  @IsIn(AUDIT_ACTIONS as unknown as string[])
  action?: string;

  @ApiPropertyOptional({ enum: AUDIT_MODULES })
  @IsOptional()
  @IsIn(AUDIT_MODULES as unknown as string[])
  module?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
