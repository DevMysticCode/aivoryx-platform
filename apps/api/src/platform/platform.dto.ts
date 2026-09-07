import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ErrorResponseBody } from '@aivoryx/shared';

/** Mirrors the platform error envelope (ADR 0014) for OpenAPI. */
export class ApiErrorDto {
  @ApiProperty({
    example: {
      code: 'PLATFORM_ADMIN_REQUIRED',
      message: 'This action requires Aivoryx platform administration.',
      correlationId: 'AIV-...',
    },
  })
  error!: ErrorResponseBody['error'];
}

export class PlatformModuleCatalogueDto {
  @ApiProperty({ example: 'CRM' }) key!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() description!: string;
  @ApiProperty() capabilitySummary!: string;
  @ApiProperty() icon!: string;
  @ApiProperty({ example: 'sales' }) category!: string;
  @ApiProperty() order!: number;
  @ApiProperty({ type: [String], example: ['CRM', 'SUPPLY'] }) dependencies!: string[];
  @ApiProperty() available!: boolean;
}

export class PlatformTenantSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: string;
  @ApiProperty() memberCount!: number;
  @ApiProperty() enabledModuleCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PlatformTenantModuleDto {
  @ApiProperty({ example: 'HR' }) key!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() description!: string;
  @ApiProperty() capabilitySummary!: string;
  @ApiProperty() category!: string;
  @ApiProperty() order!: number;
  @ApiProperty({ type: [String] }) dependencies!: string[];
  @ApiProperty({ enum: ['ENABLED', 'DISABLED'] }) state!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) enabledAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) disabledAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  provisionedByUserId!: string | null;
}

export class PlatformTenantDetailDto extends PlatformTenantSummaryDto {
  @ApiProperty({ type: [PlatformTenantModuleDto] }) modules!: PlatformTenantModuleDto[];
}

export class SetTenantModuleRequestDto {
  @ApiProperty({ enum: ['ENABLED', 'DISABLED'] })
  @IsIn(['ENABLED', 'DISABLED'])
  state!: 'ENABLED' | 'DISABLED';

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PlatformOverviewDto {
  @ApiProperty() tenantCount!: number;
  @ApiProperty() activeTenantCount!: number;
  @ApiProperty() moduleCount!: number;
  @ApiProperty({ type: [PlatformModuleCatalogueDto] }) modules!: PlatformModuleCatalogueDto[];
}
