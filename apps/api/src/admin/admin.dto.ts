import { ApiProperty } from '@nestjs/swagger';

export class AdminMembershipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'email' })
  userEmail!: string;

  @ApiProperty({ enum: ['active', 'suspended'] })
  status!: 'active' | 'suspended';

  @ApiProperty({ type: [String] })
  roleKeys!: string[];
}

export class AdminRoleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'TENANT_ADMIN' })
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  permissionKeys!: string[];
}

export class CataloguePermissionDto {
  @ApiProperty({ example: 'users.read' })
  key!: string;

  @ApiProperty()
  description!: string;
}
