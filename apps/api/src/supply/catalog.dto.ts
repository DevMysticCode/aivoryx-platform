import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ---- units --------------------------------------------------------

export class UpsertUnitDto {
  @ApiProperty({ maxLength: 20, example: 'PCS' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UnitDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
}

// ---- categories --------------------------------------------------

export class UpsertCategoryDto {
  @ApiProperty({ maxLength: 40, example: 'PANELS' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
}

// ---- products --------------------------------------------------

export class CreateProductDto {
  @ApiProperty({ maxLength: 60, example: 'PANEL-550' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  sku!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  unitId!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiProperty({ required: false, description: 'Decimal string; low-stock threshold.' })
  @IsOptional()
  @IsNumberString()
  reorderLevel?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  unitId?: string;

  @ApiProperty({ required: false, format: 'uuid', nullable: true })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumberString()
  reorderLevel?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ProductDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ format: 'uuid' }) unitId!: string;
  @ApiProperty() unitCode!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) categoryId!: string | null;
  @ApiProperty({ nullable: true, type: String }) categoryName!: string | null;
  @ApiProperty({ nullable: true, type: String }) brand!: string | null;
  @ApiProperty({ nullable: true, type: String }) model!: string | null;
  @ApiProperty({ nullable: true, type: String }) reorderLevel!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ProductListDto {
  @ApiProperty({ type: [ProductDto] }) items!: ProductDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListProductsQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() q?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() categoryId?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
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

// ---- suppliers -----------------------------------------------

export class CreateSupplierDto {
  @ApiProperty({ maxLength: 40 }) @IsString() @MinLength(1) @MaxLength(40) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;
  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactEmail?: string;
  @ApiProperty({ required: false, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;
  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;
  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
  @ApiProperty({ required: false, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  taxReference?: string;
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSupplierDto extends CreateSupplierDto {
  @ApiProperty({ required: false, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  declare code: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name: string;
}

export class SupplierDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) contactName!: string | null;
  @ApiProperty({ nullable: true, type: String }) contactEmail!: string | null;
  @ApiProperty({ nullable: true, type: String }) contactPhone!: string | null;
  @ApiProperty({ nullable: true, type: String }) addressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ nullable: true, type: String }) state!: string | null;
  @ApiProperty({ nullable: true, type: String }) postalCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) country!: string | null;
  @ApiProperty({ nullable: true, type: String }) taxReference!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

// ---- warehouses --------------------------------------------

export class CreateWarehouseDto {
  @ApiProperty({ maxLength: 40 }) @IsString() @MinLength(1) @MaxLength(40) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiProperty({ enum: ['main', 'regional', 'transit', 'site'] })
  @IsIn(['main', 'regional', 'transit', 'site'])
  type!: 'main' | 'regional' | 'transit' | 'site';
  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;
  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateWarehouseDto extends CreateWarehouseDto {
  @ApiProperty({ required: false, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  declare code: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name: string;

  @ApiProperty({ required: false, enum: ['main', 'regional', 'transit', 'site'] })
  @IsOptional()
  @IsIn(['main', 'regional', 'transit', 'site'])
  declare type: 'main' | 'regional' | 'transit' | 'site';
}

export class WarehouseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['main', 'regional', 'transit', 'site'] }) type!: string;
  @ApiProperty({ nullable: true, type: String }) addressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ nullable: true, type: String }) state!: string | null;
  @ApiProperty({ nullable: true, type: String }) postalCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) country!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
