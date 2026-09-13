import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TENANT_STATUSES, type ErrorResponseBody } from '@aivoryx/shared';

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
  @ApiProperty({ enum: TENANT_STATUSES }) status!: string;
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

export class TenantSubscriptionDto {
  @ApiProperty({ example: 'AIVORYX_SOLAR' }) planKey!: string;
  @ApiProperty({ enum: ['active', 'canceled', 'expired'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
}

export class PlatformTenantDetailDto extends PlatformTenantSummaryDto {
  @ApiProperty({ type: [PlatformTenantModuleDto] }) modules!: PlatformTenantModuleDto[];
  @ApiProperty({ nullable: true, type: TenantSubscriptionDto })
  subscription!: TenantSubscriptionDto | null;
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

// ---- Phase 14: solutions, plans, provisioning, lifecycle, usage ---------

export class SolutionDto {
  @ApiProperty({ example: 'SOLAR_EPC' }) key!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [String], example: ['CRM', 'FIELD', 'SUPPLY'] }) moduleKeys!: string[];
}

export class PlanDto {
  @ApiProperty({ example: 'AIVORYX_SOLAR' }) key!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ example: 'SOLAR_EPC' }) solutionKey!: string;
}

export class CreateTenantRequestDto {
  @ApiProperty({ example: 'Acme Field Services' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  primaryContactName?: string;

  @ApiProperty({ required: false, maxLength: 60, example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiProperty({ required: false, maxLength: 10, example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiProperty({ example: 'SOLAR_EPC' })
  @IsString()
  solutionKey!: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: "Override the solution's recommended modules (still dependency-checked).",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  moduleKeys?: string[];

  @ApiProperty({ required: false, example: 'AIVORYX_SOLAR' })
  @IsOptional()
  @IsString()
  planKey?: string;

  @ApiProperty({ format: 'email', example: 'admin@acme-field.test' })
  @IsEmail()
  @MaxLength(320)
  adminEmail!: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  adminName?: string;
}

export class ProvisioningInvitationDto {
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
  @ApiProperty({ format: 'uuid' }) invitationId!: string;
  @ApiProperty({
    description:
      'One-time invitation token. Returned ONLY here (no email provider is configured); relay it to the new admin out of band.',
  })
  token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class CreateTenantResponseDto {
  @ApiProperty({ type: PlatformTenantDetailDto }) tenant!: PlatformTenantDetailDto;
  @ApiProperty({ type: ProvisioningInvitationDto }) invitation!: ProvisioningInvitationDto;
}

export class SetTenantLifecycleRequestDto {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class TenantUsageDto {
  @ApiProperty() members!: number;
  @ApiProperty({ nullable: true, type: Number }) leads!: number | null;
  @ApiProperty({ nullable: true, type: Number }) projects!: number | null;
  @ApiProperty({ nullable: true, type: Number }) invoices!: number | null;
  @ApiProperty({ nullable: true, type: Number }) employees!: number | null;
  @ApiProperty() enabledModules!: number;
}
