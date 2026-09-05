import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const PROJECT_STATUSES = [
  'DRAFT',
  'APPROVED',
  'PROCUREMENT',
  'READY_FOR_DISPATCH',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
] as const;

export class CreateProjectDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  leadId!: string;

  @ApiProperty({ required: false, maxLength: 40, description: 'Auto-generated if omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  number?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;
}

export class SetProjectStatusDto {
  @ApiProperty({ enum: PROJECT_STATUSES })
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status!: (typeof PROJECT_STATUSES)[number];
}

export class UpsertMaterialDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  productId!: string;

  @ApiProperty({ description: 'Decimal string.' })
  @IsNumberString()
  requiredQty!: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateMaterialDto {
  @ApiProperty({ required: false, description: 'Decimal string.' })
  @IsOptional()
  @IsNumberString()
  requiredQty?: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AllocateMaterialDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  warehouseId!: string;

  @ApiProperty({ description: 'Decimal string, > 0.' })
  @IsNumberString()
  quantity!: string;

  @ApiProperty({
    required: false,
    maxLength: 100,
    description: 'Retry key — a repeated call with the same key is a no-op.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}

// ---- responses -------------------------------------------------

export class ProjectMaterialDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productSku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() unitCode!: string;
  @ApiProperty() requiredQty!: string;
  @ApiProperty() allocatedQty!: string;
  @ApiProperty() dispatchedQty!: string;
  @ApiProperty() deliveredQty!: string;
  @ApiProperty({ description: 'required - allocated' }) remainingQty!: string;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
}

export class ProjectActivityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty({ type: Object, additionalProperties: true }) payload!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ProjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ nullable: true, type: String }) leadName!: string | null;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty({ enum: PROJECT_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) siteAddressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) siteCity!: string | null;
  @ApiProperty({ nullable: true, type: String }) siteState!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) approvedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ProjectDetailDto extends ProjectDto {
  @ApiProperty({ type: [ProjectMaterialDto] }) materials!: ProjectMaterialDto[];
}

export class ProjectListDto {
  @ApiProperty({ type: [ProjectDto] }) items!: ProjectDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListProjectsQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() status?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() q?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() leadId?: string;
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export { PROJECT_STATUSES };
