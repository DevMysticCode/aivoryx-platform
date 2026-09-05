import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class StockLevelDto {
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productSku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() unitCode!: string;
  @ApiProperty() onHand!: string;
  @ApiProperty() reserved!: string;
  @ApiProperty({ description: 'onHand - reserved' }) available!: string;
  @ApiProperty({ nullable: true, type: String }) reorderLevel!: string | null;
  @ApiProperty({ description: 'onHand <= reorderLevel' }) lowStock!: boolean;
}

export class StockLevelListDto {
  @ApiProperty({ type: [StockLevelDto] }) items!: StockLevelDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListStockQueryDto {
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() warehouseId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() productId?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStock?: boolean;
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class StockMovementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseCode!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productSku!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() onHandDelta!: string;
  @ApiProperty() reservedDelta!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) projectId!: string | null;
  @ApiProperty({ nullable: true, type: String }) referenceType!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class StockMovementListDto {
  @ApiProperty({ type: [StockMovementDto] }) items!: StockMovementDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListMovementsQueryDto {
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() warehouseId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() productId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() projectId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() type?: string;
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class AdjustStockDto {
  @ApiProperty({ format: 'uuid' }) @IsString() warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) @IsString() productId!: string;
  @ApiProperty({ description: 'Signed decimal string — the on-hand delta.' })
  @IsNumberString()
  delta!: string;
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}

export class TransferStockDto {
  @ApiProperty({ format: 'uuid' }) @IsString() sourceWarehouseId!: string;
  @ApiProperty({ format: 'uuid' }) @IsString() destinationWarehouseId!: string;
  @ApiProperty({ format: 'uuid' }) @IsString() productId!: string;
  @ApiProperty({ description: 'Decimal string, > 0.' }) @IsNumberString() quantity!: string;
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}
