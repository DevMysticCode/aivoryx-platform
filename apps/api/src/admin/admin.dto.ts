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

// ---- tenant --------------------------------------------------------------

export class TenantMemberCountsDto {
  @ApiProperty() active!: number;
  @ApiProperty() invited!: number;
  @ApiProperty() suspended!: number;
  @ApiProperty() total!: number;
}

export class TenantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'acme' })
  slug!: string;

  @ApiProperty({ example: 'Acme Inc.' })
  name!: string;

  @ApiProperty({ enum: ['active', 'suspended'] })
  status!: 'active' | 'suspended';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: TenantMemberCountsDto })
  memberCounts!: TenantMemberCountsDto;
}

export class UpdateTenantRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 200, example: 'Acme Incorporated' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

// ---- members ----------------------------------------------------------

export class MemberRoleDto {
  @ApiProperty({ example: 'TENANT_ADMIN' })
  key!: string;

  @ApiProperty({ example: 'Workspace administrator' })
  name!: string;
}

export class MemberDto {
  @ApiProperty({ format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ enum: ['active', 'suspended', 'invited'] })
  status!: 'active' | 'suspended' | 'invited';

  @ApiProperty({ type: [MemberRoleDto] })
  roles!: MemberRoleDto[];

  @ApiProperty({ format: 'date-time' })
  joinedAt!: string;

  @ApiProperty({ description: 'True while an invitation for this membership is still pending.' })
  invitationPending!: boolean;
}

export class InviteMemberRequestDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false, type: [String], description: 'Generic platform role keys.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  roleKeys?: string[];
}

export class InvitationHandoffDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'One-time invitation token. Returned ONLY here (no email provider is configured); relay it to the invitee out of band.',
  })
  token!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class InviteMemberResponseDto {
  @ApiProperty({ type: MemberDto })
  member!: MemberDto;

  @ApiProperty({ type: InvitationHandoffDto })
  invitation!: InvitationHandoffDto;
}

export class UpdateMemberRequestDto {
  @ApiProperty({
    enum: ['active', 'suspended'],
    description: 'Reactivate or suspend the membership.',
  })
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';
}

export class AssignRoleRequestDto {
  @ApiProperty({ example: 'TENANT_ADMIN' })
  @IsString()
  @MaxLength(64)
  roleKey!: string;
}

// ---- roles ----------------------------------------------------------

export class AdminRoleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'TENANT_ADMIN' })
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ type: [String] })
  permissionKeys!: string[];
}

export class CataloguePermissionDto {
  @ApiProperty({ example: 'users.read' })
  key!: string;

  @ApiProperty()
  description!: string;
}

// ---- invitation acceptance (public) --------------------------------

export class AcceptInvitationRequestDto {
  @ApiProperty({ description: 'The one-time token from the invitation link.' })
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  token!: string;

  @ApiProperty({
    required: false,
    minLength: 8,
    maxLength: 200,
    description: 'Required only when the invited account has no password yet.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class AcceptInvitationResponseDto {
  @ApiProperty({ example: true })
  ok!: true;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ example: 'acme' })
  tenantSlug!: string;
}

// The standard error envelope is defined once, in the auth DTOs.
export { ApiErrorDto } from '../auth/auth.dto.js';
