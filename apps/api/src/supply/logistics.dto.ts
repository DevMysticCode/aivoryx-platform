import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DispatchLineInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  productId!: string;

  @ApiProperty({ description: 'Decimal string, > 0.' })
  @IsNumberString()
  quantity!: string;
}

export class CreateDispatchDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  projectId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  warehouseId!: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  destinationAddress?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [DispatchLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DispatchLineInputDto)
  lines!: DispatchLineInputDto[];
}

export class UpdateDispatchDto {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  destinationAddress?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ required: false, type: [DispatchLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchLineInputDto)
  lines?: DispatchLineInputDto[];
}

export class DeliveryLineInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  dispatchLineId!: string;

  @ApiProperty({ description: 'Decimal string.' })
  @IsNumberString()
  deliveredQty!: string;
}

export class DeliverDispatchDto {
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryNotes?: string;

  @ApiProperty({
    required: false,
    type: [DeliveryLineInputDto],
    description: 'Per-line delivered quantities; omit to accept every line in full.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineInputDto)
  lines?: DeliveryLineInputDto[];
}

// ---- responses ---------------------------------------------

export class DispatchLineDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productSku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() deliveredQty!: string;
}

export class DispatchAttachmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dispatchId!: string;
  @ApiProperty({ nullable: true, type: String }) originalFilename!: string | null;
  @ApiProperty() contentType!: string;
  @ApiProperty() fileSize!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class DispatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() projectNumber!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ enum: ['DRAFT', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) destinationAddress!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ nullable: true, type: String }) deliveryNotes!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) dispatchedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) deliveredAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class DispatchDetailDto extends DispatchDto {
  @ApiProperty({ type: [DispatchLineDto] }) lines!: DispatchLineDto[];
  @ApiProperty({ type: [DispatchAttachmentDto] }) attachments!: DispatchAttachmentDto[];
}

export class DispatchListDto {
  @ApiProperty({ type: [DispatchDto] }) items!: DispatchDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListDispatchesQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() status?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() projectId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() warehouseId?: string;
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
