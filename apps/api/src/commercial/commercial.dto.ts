import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'BOOKED', 'CANCELLED', 'EXPIRED'] as const;

// ---- customers --------------------------------------------------

export class CreateCustomerDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false, maxLength: 40, description: 'Auto-generated if omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  number?: string;

  @ApiProperty({ required: false, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

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

  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  siteAddressLine?: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  siteCity?: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  siteState?: string;

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
}

export class UpdateCustomerDto extends CreateCustomerDto {
  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name: string;

  @ApiProperty({ required: false, enum: ['prospect', 'active', 'inactive'] })
  @IsOptional()
  @IsIn(['prospect', 'active', 'inactive'])
  status?: 'prospect' | 'active' | 'inactive';
}

export class CustomerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ nullable: true, type: String }) addressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ nullable: true, type: String }) state!: string | null;
  @ApiProperty({ nullable: true, type: String }) postalCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) country!: string | null;
  @ApiProperty({ nullable: true, type: String }) siteAddressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) siteCity!: string | null;
  @ApiProperty({ nullable: true, type: String }) siteState!: string | null;
  @ApiProperty({ nullable: true, type: String }) taxReference!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ enum: ['prospect', 'active', 'inactive'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) leadId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CustomerLinkDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ nullable: true, type: String }) status!: string | null;
}

export class CustomerDetailDto extends CustomerDto {
  @ApiProperty({ type: [CustomerLinkDto] }) leads!: CustomerLinkDto[];
  @ApiProperty({ type: [CustomerLinkDto] }) quotations!: CustomerLinkDto[];
  @ApiProperty({ type: [CustomerLinkDto] }) projects!: CustomerLinkDto[];
}

export class CustomerListDto {
  @ApiProperty({ type: [CustomerDto] }) items!: CustomerDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListCustomersQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() q?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() status?: string;
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

export class PromoteLeadDto {
  @ApiProperty({ required: false, maxLength: 40, description: 'Auto-generated if omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  number?: string;
}

// ---- quotations ----------------------------------------------

export class QuotationLineInputDto {
  @ApiProperty({ required: false, format: 'uuid', description: 'Optional catalogue product.' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({
    required: false,
    maxLength: 500,
    description:
      'Line description. Required for service/custom lines; defaults to the product name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ required: false, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unitLabel?: string;

  @ApiProperty({ description: 'Decimal string, >= 0.' })
  @IsNumberString()
  quantity!: string;

  @ApiProperty({ description: 'Decimal money string, >= 0.' })
  @IsNumberString()
  unitPrice!: string;

  @ApiProperty({ required: false, description: 'Decimal money string, >= 0.' })
  @IsOptional()
  @IsNumberString()
  discount?: string;

  @ApiProperty({ required: false, description: 'Rate, e.g. 0.18 for 18%.' })
  @IsOptional()
  @IsNumberString()
  taxRate?: string;
}

export class CreateQuotationDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  leadId!: string;

  @ApiProperty({ required: false, format: 'uuid', description: 'Link an existing customer.' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ required: false, format: 'uuid', description: 'Link an existing draft project.' })
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
  issueDate?: string;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  validityDate?: string;

  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiProperty({ type: [QuotationLineInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineInputDto)
  lines?: QuotationLineInputDto[];
}

export class UpdateQuotationDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  customerId?: string | null;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  projectId?: string | null;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  issueDate?: string;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  validityDate?: string;

  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiProperty({ type: [QuotationLineInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineInputDto)
  lines?: QuotationLineInputDto[];
}

export class ReviseQuotationDto {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AcceptQuotationDto {
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class BookQuotationDto {
  @ApiProperty({
    required: false,
    maxLength: 100,
    description: 'Retry key — a repeated booking with the same key is a no-op.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}

// ---- quotation responses ---------------------------------------

export class QuotationLineDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) productId!: string | null;
  @ApiProperty({ nullable: true, type: String }) productSku!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true, type: String }) unitLabel!: string | null;
  @ApiProperty() quantity!: string;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() discount!: string;
  @ApiProperty() taxRate!: string;
  @ApiProperty() lineNet!: string;
  @ApiProperty() lineTax!: string;
  @ApiProperty() lineTotal!: string;
}

export class QuotationRevisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() revisionNo!: number;
  @ApiProperty({ enum: ['draft', 'sent', 'accepted', 'superseded'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) issueDate!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) validityDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() total!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) sentAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) acceptedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) acceptedByName!: string | null;
  @ApiProperty({ nullable: true, type: String }) acceptanceNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [QuotationLineDto] }) lines!: QuotationLineDto[];
}

export class QuotationActivityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty({ type: Object, additionalProperties: true }) payload!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class QuotationAttachmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) quotationId!: string;
  @ApiProperty({ nullable: true, type: String }) originalFilename!: string | null;
  @ApiProperty() contentType!: string;
  @ApiProperty() fileSize!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class QuotationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ enum: QUOTATION_STATUSES }) status!: string;
  @ApiProperty() currentRevisionNo!: number;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ nullable: true, type: String }) leadName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) customerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) projectId!: string | null;
  @ApiProperty({ nullable: true, type: String }) projectNumber!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) validityDate!: string | null;
  @ApiProperty() total!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) bookedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class QuotationDetailDto extends QuotationDto {
  @ApiProperty({ type: QuotationRevisionDto }) currentRevision!: QuotationRevisionDto;
  @ApiProperty({ type: [QuotationRevisionDto] }) revisions!: QuotationRevisionDto[];
}

export class QuotationListDto {
  @ApiProperty({ type: [QuotationDto] }) items!: QuotationDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ListQuotationsQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() status?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() customerId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsString() leadId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() q?: string;
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

export class BookingResultDto {
  @ApiProperty({ type: QuotationDto }) quotation!: QuotationDto;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() projectNumber!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
}

export { QUOTATION_STATUSES };
