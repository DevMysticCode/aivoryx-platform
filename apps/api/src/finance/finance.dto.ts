import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const INVOICE_STATUS = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID'] as const;
const PAYMENT_STATUS = ['RECORDED', 'REVERSED', 'CANCELLED'] as const;
const PAYMENT_METHOD = ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'] as const;
const CREDIT_NOTE_STATUS = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
const DISCOUNT_TYPE = ['AMOUNT', 'PERCENT'] as const;

// ---- shared fragments ---------------------------------------------

export class MoneyLineDto {
  @ApiProperty() lineNo!: number;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) productId!: string | null;
  @ApiProperty({ nullable: true, type: String }) unitLabel!: string | null;
  @ApiProperty() quantity!: string;
  @ApiProperty() unitPrice!: string;
  @ApiProperty({ enum: DISCOUNT_TYPE }) discountType!: string;
  @ApiProperty() discountValue!: string;
  @ApiProperty({ nullable: true, type: String }) taxName!: string | null;
  @ApiProperty() taxRate!: string;
  @ApiProperty() lineSubtotal!: string;
  @ApiProperty() lineDiscount!: string;
  @ApiProperty() lineTaxable!: string;
  @ApiProperty() lineTax!: string;
  @ApiProperty() lineTotal!: string;
}

export class InvoiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) projectId!: string | null;
  @ApiProperty({ nullable: true, type: String }) projectNumber!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) quotationId!: string | null;
  @ApiProperty({ enum: ['manual', 'quotation', 'project'] }) source!: string;
  @ApiProperty({ enum: INVOICE_STATUS }) status!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: String }) issueDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) dueDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountTotal!: string;
  @ApiProperty() taxTotal!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty() amountPaid!: string;
  @ApiProperty() amountCredited!: string;
  @ApiProperty() amountOutstanding!: string;
  @ApiProperty() overdue!: boolean;
  @ApiProperty() daysOverdue!: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) issuedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AllocationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty() paymentNumber!: string;
  @ApiProperty({ format: 'uuid' }) invoiceId!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() reversed!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class InvoiceDetailDto extends InvoiceDto {
  @ApiProperty({ type: [MoneyLineDto] }) lines!: MoneyLineDto[];
  @ApiProperty({ type: [AllocationDto] }) allocations!: AllocationDto[];
}

export class InvoiceListDto {
  @ApiProperty({ type: [InvoiceDto] }) items!: InvoiceDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class PaymentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty() paymentDate!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PAYMENT_METHOD }) method!: string;
  @ApiProperty({ nullable: true, type: String }) reference!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ enum: PAYMENT_STATUS }) status!: string;
  @ApiProperty() allocatedAmount!: string;
  @ApiProperty() unallocatedAmount!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) reversedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) reversalReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PaymentDetailDto extends PaymentDto {
  @ApiProperty({ type: [AllocationDto] }) allocations!: AllocationDto[];
}

export class PaymentListDto {
  @ApiProperty({ type: [PaymentDto] }) items!: PaymentDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class CreditNoteDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) invoiceId!: string | null;
  @ApiProperty({ nullable: true, type: String }) invoiceNumber!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) projectId!: string | null;
  @ApiProperty({ enum: CREDIT_NOTE_STATUS }) status!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: String }) issueDate!: string | null;
  @ApiProperty() reason!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) issuedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CreditNoteListDto {
  @ApiProperty({ type: [CreditNoteDto] }) items!: CreditNoteDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class FinancialSummaryDto {
  @ApiProperty() currency!: string;
  @ApiProperty() invoicedTotal!: string;
  @ApiProperty() paidTotal!: string;
  @ApiProperty() creditedTotal!: string;
  @ApiProperty() outstandingTotal!: string;
  @ApiProperty() overdueTotal!: string;
  @ApiProperty() invoiceCount!: number;
  @ApiProperty() overdueCount!: number;
}

export class CustomerFinancialViewDto extends FinancialSummaryDto {
  @ApiProperty({ type: [InvoiceDto] }) recentInvoices!: InvoiceDto[];
  @ApiProperty({ type: [PaymentDto] }) recentPayments!: PaymentDto[];
}

export class FinanceOverviewDto {
  @ApiProperty({ type: [FinancialSummaryDto] }) byCurrency!: FinancialSummaryDto[];
}

// ---- request DTOs -----------------------------------------------

export class InvoiceLineInputDto {
  @ApiProperty() @IsString() @MaxLength(500) description!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) reference?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() productId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) unitLabel?: string;
  @ApiProperty({ example: '1' }) @IsString() quantity!: string;
  @ApiProperty({ example: '1000.00' }) @IsString() unitPrice!: string;
  @ApiProperty({ required: false, enum: DISCOUNT_TYPE })
  @IsOptional()
  @IsIn(DISCOUNT_TYPE as unknown as string[])
  discountType?: string;
  @ApiProperty({ required: false, example: '0' }) @IsOptional() @IsString() discountValue?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) taxName?: string;
  @ApiProperty({ required: false, example: '0.18' }) @IsOptional() @IsString() taxRate?: string;
}

export class CreateInvoiceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() customerId!: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() quotationId?: string;
  @ApiProperty({ required: false, example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() issueDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() dueDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @ApiProperty({ type: [InvoiceLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineInputDto)
  lines!: InvoiceLineInputDto[];
}

export class UpdateInvoiceDto {
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() issueDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() dueDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiProperty({ required: false, type: [InvoiceLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineInputDto)
  lines?: InvoiceLineInputDto[];
}

export class IssueInvoiceDto {
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() issueDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() dueDate?: string;
}

export class CancelInvoiceDto {
  @ApiProperty({ required: false, enum: ['CANCELLED', 'VOID'] })
  @IsOptional()
  @IsIn(['CANCELLED', 'VOID'])
  mode?: 'CANCELLED' | 'VOID';
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CreateInvoiceFromQuotationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() quotationId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() dueDate?: string;
}

export class AllocationInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() invoiceId!: string;
  @ApiProperty({ example: '1000.00' }) @IsString() amount!: string;
}

export class RecordPaymentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() customerId!: string;
  @ApiProperty() @IsISO8601() paymentDate!: string;
  @ApiProperty({ example: '50000.00' }) @IsString() amount!: string;
  @ApiProperty({ required: false, example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
  @ApiProperty({ required: false, enum: PAYMENT_METHOD })
  @IsOptional()
  @IsIn(PAYMENT_METHOD as unknown as string[])
  method?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerReference?: string;
  @ApiProperty({
    required: false,
    description: 'Optional: allocate the payment to these invoices in the same request.',
    type: [AllocationInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  allocations?: AllocationInputDto[];
}

export class AllocatePaymentDto {
  @ApiProperty({ type: [AllocationInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  allocations!: AllocationInputDto[];
}

export class ReversePaymentDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CreateCreditNoteDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() customerId!: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() invoiceId?: string;
  @ApiProperty({ required: false, format: 'uuid' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiProperty({ example: '10000.00' }) @IsString() amount!: string;
  @ApiProperty({ required: false, example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
  @ApiProperty() @IsString() @MaxLength(500) reason!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() issueDate?: string;
}

export class CancelCreditNoteDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ListInvoicesQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
  @ApiProperty({ required: false, enum: INVOICE_STATUS })
  @IsOptional()
  @IsIn(INVOICE_STATUS as unknown as string[])
  status?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
  @ApiProperty({ required: false, type: Boolean })
  @IsOptional()
  @Type(() => Boolean)
  overdue?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() from?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() to?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() q?: string;
}

export class ListPaymentsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
  @ApiProperty({ required: false, enum: PAYMENT_STATUS })
  @IsOptional()
  @IsIn(PAYMENT_STATUS as unknown as string[])
  status?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
  @ApiProperty({ required: false, type: Boolean })
  @IsOptional()
  @Type(() => Boolean)
  unallocatedOnly?: boolean;
}

export class ListCreditNotesQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
  @ApiProperty({ required: false, enum: CREDIT_NOTE_STATUS })
  @IsOptional()
  @IsIn(CREDIT_NOTE_STATUS as unknown as string[])
  status?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class OverdueSweepResultDto {
  @ApiProperty() notified!: number;
}
