import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PoLineInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  productId!: string;

  @ApiProperty({ description: 'Decimal string, > 0.' })
  @IsNumberString()
  orderedQty!: string;

  @ApiProperty({ required: false, description: 'Decimal money string.' })
  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @ApiProperty({ required: false, description: 'Rate e.g. 0.18 for 18%.' })
  @IsOptional()
  @IsNumberString()
  taxRate?: string;

  @ApiProperty({ required: false, description: 'Decimal money string.' })
  @IsOptional()
  @IsNumberString()
  discount?: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  supplierId!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ required: false, maxLength: 40, description: 'Auto-generated if omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  number?: string;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  orderDate?: string;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  expectedDate?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [PoLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PoLineInputDto)
  lines!: PoLineInputDto[];
}

export class UpdatePurchaseOrderDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  projectId?: string | null;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  orderDate?: string;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  expectedDate?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ required: false, type: [PoLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoLineInputDto)
  lines?: PoLineInputDto[];
}

export class ReceiptLineInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  purchaseOrderLineId!: string;

  @ApiProperty({ description: 'Decimal string, > 0.' })
  @IsNumberString()
  receivedQty!: string;
}

export class ReceivePurchaseOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  warehouseId!: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({
    required: false,
    maxLength: 100,
    description: 'Retry key — a repeated call with the same key returns the same receipt.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiProperty({ type: [ReceiptLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineInputDto)
  lines!: ReceiptLineInputDto[];
}

// ---- responses ----------------------------------------------

export class PoLineDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productSku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() orderedQty!: string;
  @ApiProperty() receivedQty!: string;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() taxRate!: string;
  @ApiProperty() discount!: string;
  @ApiProperty() lineTotal!: string;
}

export class GoodsReceiptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ type: Object, additionalProperties: true }) lines!: Record<string, string>;
}

export class PurchaseOrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ format: 'uuid' }) supplierId!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) projectId!: string | null;
  @ApiProperty({ nullable: true, type: String }) projectNumber!: string | null;
  @ApiProperty({
    enum: [
      'DRAFT',
      'SUBMITTED',
      'APPROVED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CLOSED',
      'CANCELLED',
    ],
  })
  status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) orderDate!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) expectedDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty() subtotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() total!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) approvedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PurchaseOrderDetailDto extends PurchaseOrderDto {
  @ApiProperty({ type: [PoLineDto] }) lines!: PoLineDto[];
  @ApiProperty({ type: [GoodsReceiptDto] }) receipts!: GoodsReceiptDto[];
}

export class PurchaseOrderListDto {
  @ApiProperty({ type: [PurchaseOrderDto] }) items!: PurchaseOrderDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListPurchaseOrdersQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() status?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() supplierId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() projectId?: string;
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
