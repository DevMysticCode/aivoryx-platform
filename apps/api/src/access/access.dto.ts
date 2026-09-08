import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY'] as const;

export class AvailablePermissionDto {
  @ApiProperty() key!: string;
  @ApiProperty({ nullable: true, type: String, example: 'CRM' }) module!: string | null;
  @ApiProperty() resource!: string;
  @ApiProperty() action!: string;
  @ApiProperty() description!: string;
}

export class AccessRoleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: ['profile', 'permission_set'] }) kind!: string;
  @ApiProperty({ type: [String] }) permissionKeys!: string[];
  @ApiProperty() assignedCount!: number;
}

export class CreateAccessRoleDto {
  @ApiProperty() @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class UpdateAccessRoleDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys?: string[];
}

export class AssignProfileDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() roleId!: string;
  @ApiProperty({ enum: SCOPES, default: 'COMPANY' })
  @IsIn(SCOPES as unknown as string[])
  dataScope!: (typeof SCOPES)[number];
}

export class AddPermissionSetDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() roleId!: string;
}

export class EffectiveModulePermissionDto {
  @ApiProperty() key!: string;
  @ApiProperty() resource!: string;
  @ApiProperty() action!: string;
  @ApiProperty() description!: string;
  @ApiProperty() granted!: boolean;
}

export class EffectiveModuleAccessDto {
  @ApiProperty({ example: 'CRM' }) moduleKey!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() entitled!: boolean;
  @ApiProperty({ nullable: true, enum: SCOPES }) dataScope!: string | null;
  @ApiProperty({ type: [EffectiveModulePermissionDto] })
  permissions!: EffectiveModulePermissionDto[];
}

export class EffectiveProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: SCOPES }) dataScope!: string;
}

export class EffectivePermissionSetDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class EffectiveAccessDto {
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
  @ApiProperty({ nullable: true, type: String }) userName!: string | null;
  @ApiProperty() userEmail!: string;
  @ApiProperty({ nullable: true, type: EffectiveProfileDto })
  profile!: EffectiveProfileDto | null;
  @ApiProperty({ type: [EffectivePermissionSetDto] })
  permissionSets!: EffectivePermissionSetDto[];
  @ApiProperty({ type: [EffectiveModuleAccessDto] }) modules!: EffectiveModuleAccessDto[];
  @ApiProperty({ type: [String] }) platformPermissions!: string[];
}
