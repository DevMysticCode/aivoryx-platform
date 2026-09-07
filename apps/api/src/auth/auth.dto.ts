import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// ---- requests -------------------------------------------------------------

export class LoginRequestDto {
  @ApiProperty({ format: 'email', example: 'admin@acme.test' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 200, example: 'correct horse battery staple' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class SwitchTenantRequestDto {
  @ApiProperty({ format: 'uuid', description: 'A membership id belonging to the current user.' })
  @IsUUID()
  membershipId!: string;
}

// ---- shared response shapes --------------------------------------------

export class MembershipSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'acme' })
  tenantSlug!: string;

  @ApiProperty({ example: 'Acme Inc.' })
  tenantName!: string;

  @ApiProperty({ enum: ['active', 'suspended'] })
  tenantStatus!: 'active' | 'suspended';

  @ApiProperty({ enum: ['active', 'suspended', 'invited'] })
  status!: 'active' | 'suspended' | 'invited';
}

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: 'active' | 'disabled';
}

export class BrandingContextDto {
  @ApiProperty({ example: 'Acme Solar', description: 'Workspace display name for the app shell.' })
  displayName!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '#1e3a8a',
    description: 'Validated 6-digit hex primary brand colour, or null for the Aivoryx default.',
  })
  primaryColor!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '#f97316' })
  accentColor!: string | null;

  @ApiProperty({ description: 'True when the workspace has uploaded a logo.' })
  hasLogo!: boolean;
}

export class ActiveContextDto {
  @ApiProperty({ type: MembershipSummaryDto })
  membership!: MembershipSummaryDto;

  @ApiProperty({
    type: [String],
    description:
      'Effective permission keys: granted in this tenant AND belonging to an entitled module ' +
      '(or a platform permission). Entitlement always precedes permission (ADR 0042).',
  })
  permissions!: string[];

  @ApiProperty({ type: [String], description: 'Role keys held in this tenant.' })
  roles!: string[];

  @ApiProperty({
    type: [String],
    description: 'Module keys this workspace is entitled to (e.g. ["CRM","HR"]).',
  })
  entitledModules!: string[];

  @ApiProperty({
    type: BrandingContextDto,
    description: 'Safe tenant branding for the app shell (never a security boundary).',
  })
  branding!: BrandingContextDto;
}

// ---- endpoint responses ---------------------------------------------------

export class MeResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({
    description: 'True if this user is an Aivoryx platform administrator (not tenant-scoped).',
  })
  isPlatformAdmin!: boolean;

  @ApiProperty({ type: [MembershipSummaryDto] })
  memberships!: MembershipSummaryDto[];

  @ApiProperty({
    type: ActiveContextDto,
    nullable: true,
    description: 'Null until the session has a usable active tenant.',
  })
  active!: ActiveContextDto | null;

  @ApiProperty({ format: 'date-time' })
  sessionExpiresAt!: string;
}

export class LoginResponseDto extends MeResponseDto {
  @ApiProperty({
    description: 'True when the single-membership user was auto-selected into a tenant.',
  })
  tenantAutoSelected!: boolean;
}

export class SwitchTenantResponseDto extends MeResponseDto {}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  ok!: true;
}

// ---- error envelope (for documenting 4xx) ----------------------------

export class ApiErrorDetailDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ example: 'AIV-01J9Z8ABCDEF0123456789' })
  correlationId!: string;

  @ApiProperty({ required: false, type: Object, additionalProperties: true })
  details?: Record<string, unknown>;
}

export class ApiErrorDto {
  @ApiProperty({ type: ApiErrorDetailDto })
  error!: ApiErrorDetailDto;
}
