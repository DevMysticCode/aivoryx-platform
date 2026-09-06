import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * HR & Workforce DTOs (Phase 12, ADR 0041). Narrow by design: list DTOs never
 * carry salary or bank details; sensitive DTOs are separate and permission-
 * gated; nothing exposes a raw database row.
 */

const HHMM = /^\d{2}:\d{2}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^-?\d+(\.\d{1,4})?$/;

// ===================================================================
// Organisation
// ===================================================================

export class OrgUnitDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: string;
  @ApiProperty({ description: 'Employees currently in this unit.' }) employeeCount!: number;
}

export class WorkLocationDto extends OrgUnitDto {
  @ApiProperty({ nullable: true, type: String }) addressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ nullable: true, type: String }) region!: string | null;
  @ApiProperty({ nullable: true, type: String }) country!: string | null;
  @ApiProperty({ nullable: true, type: String }) postalCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) latitude!: string | null;
  @ApiProperty({ nullable: true, type: String }) longitude!: string | null;
}

export class WorkScheduleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '09:00' }) startTime!: string;
  @ApiProperty({ example: '18:00' }) endTime!: string;
  @ApiProperty({ description: 'Bitmask: bit 0 = Monday … bit 6 = Sunday.' })
  workingDaysMask!: number;
  @ApiProperty() graceMinutes!: number;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) locationId!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: string;
}

export class CreateOrgUnitDto {
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @MaxLength(40) code!: string;
}

export class CreateWorkLocationDto extends CreateOrgUnitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) addressLine?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) latitude?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) longitude?: string;
}

export class CreateWorkScheduleDto {
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ example: '09:00' }) @Matches(HHMM) startTime!: string;
  @ApiProperty({ example: '18:00' }) @Matches(HHMM) endTime!: string;
  @ApiPropertyOptional({ default: 31 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(127)
  workingDaysMask?: number;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes?: number;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() locationId?: string;
}

export class UpdateOrgUnitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: string;
}

export class OrgChartNodeDto {
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeNumber!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) designation!: string | null;
  @ApiProperty({ nullable: true, type: String }) department!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) managerId!: string | null;
  @ApiProperty() directReports!: number;
}

export class OrgChartDto {
  @ApiProperty({ type: [OrgChartNodeDto] }) nodes!: OrgChartNodeDto[];
}

// ===================================================================
// Employees
// ===================================================================

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY'] as const;
const EMPLOYEE_STATUSES = [
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'TERMINATED',
  'RESIGNED',
  'INACTIVE',
] as const;

export class EmployeeListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() employeeNumber!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) workEmail!: string | null;
  @ApiProperty({ enum: EMPLOYEE_STATUSES }) status!: string;
  @ApiProperty({ enum: EMPLOYMENT_TYPES }) employmentType!: string;
  @ApiProperty({ nullable: true, type: String }) department!: string | null;
  @ApiProperty({ nullable: true, type: String }) designation!: string | null;
  @ApiProperty({ nullable: true, type: String }) workLocation!: string | null;
  @ApiProperty({ nullable: true, type: String }) managerName!: string | null;
  @ApiProperty() hasLogin!: boolean;
  @ApiProperty({ format: 'date' }) joiningDate!: string;
}

export class EmployeeDetailDto extends EmployeeListItemDto {
  @ApiProperty() firstName!: string;
  @ApiProperty({ nullable: true, type: String }) middleName!: string | null;
  @ApiProperty() lastName!: string;
  @ApiProperty({ nullable: true, type: String }) personalEmail!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) addressLine!: string | null;
  @ApiProperty({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ nullable: true, type: String }) region!: string | null;
  @ApiProperty({ nullable: true, type: String }) country!: string | null;
  @ApiProperty({ nullable: true, type: String }) postalCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) emergencyContactName!: string | null;
  @ApiProperty({ nullable: true, type: String }) emergencyContactPhone!: string | null;
  @ApiProperty({ nullable: true, type: String }) emergencyContactRelation!: string | null;
  @ApiProperty({ nullable: true, type: String }) category!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date' }) probationEndDate!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) departmentId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) designationId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) workLocationId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) managerId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) scheduleId!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) membershipId!: string | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CreateEmployeeDto {
  @ApiProperty() @IsString() @MaxLength(80) firstName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) middleName?: string;
  @ApiProperty() @IsString() @MaxLength(80) lastName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) workEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) personalEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) addressLine?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) emergencyContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) emergencyContactRelation?: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() joiningDate!: string;
  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES as unknown as string[])
  employmentType?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() designationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() workLocationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() scheduleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) category?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() probationEndDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateEmployeeDto extends CreateEmployeeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) declare firstName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) declare lastName: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() declare joiningDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) changeReason?: string;
}

export class ChangeEmployeeStatusDto {
  @ApiProperty({ enum: EMPLOYEE_STATUSES })
  @IsIn(EMPLOYEE_STATUSES as unknown as string[])
  status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class LinkMembershipDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() membershipId!: string;
}

export class EmploymentHistoryItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date' }) effectiveDate!: string;
  @ApiProperty() changeType!: string;
  @ApiProperty({ type: Object, nullable: true }) from!: Record<string, unknown> | null;
  @ApiProperty({ type: Object, nullable: true }) to!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class EmployeeDocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() title!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ nullable: true, type: String }) originalFilename!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AddEmployeeDocumentMetaDto {
  @ApiProperty() @IsString() @MaxLength(60) kind!: string;
  @ApiProperty() @IsString() @MaxLength(160) title!: string;
}

// --- bank details (highly sensitive; masked) --------------------

export class BankDetailsDto {
  @ApiProperty() accountHolderName!: string;
  @ApiProperty({ nullable: true, type: String }) bankName!: string | null;
  @ApiProperty({ description: 'Masked — only the last 4 digits.', example: '••••••••4821' })
  accountNumberMasked!: string;
  @ApiProperty({ nullable: true, type: String }) branch!: string | null;
  @ApiProperty({ nullable: true, type: String }) bankIdentifier!: string | null;
  @ApiProperty({ nullable: true, type: String }) swiftBic!: string | null;
  @ApiProperty({ enum: ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'] })
  preferredMethod!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class UpsertBankDetailsDto {
  @ApiProperty() @IsString() @MaxLength(160) accountHolderName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) bankName?: string;
  @ApiProperty() @IsString() @MaxLength(60) accountNumber!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) branch?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) bankIdentifier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) swiftBic?: string;
  @ApiPropertyOptional({ enum: ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'] })
  @IsOptional()
  @IsIn(['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'])
  preferredMethod?: string;
}

// ===================================================================
// Attendance
// ===================================================================

const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LATE',
  'EARLY_DEPARTURE',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKEND',
  'OTHER',
] as const;

export class GeoPointDto {
  @ApiProperty({ minimum: -90, maximum: 90 }) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @ApiProperty({ minimum: -180, maximum: 180 }) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) accuracyM?: number;
}

export class CheckInDto {
  @ApiPropertyOptional({ type: GeoPointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  point?: GeoPointDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class RecordAttendanceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() workDate!: string;
  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES as unknown as string[])
  status!: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsISO8601() checkInAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsISO8601() checkOutAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CorrectAttendanceDto {
  @ApiProperty({ enum: ['status', 'checkInAt', 'checkOutAt', 'notes'] })
  @IsIn(['status', 'checkInAt', 'checkOutAt', 'notes'])
  field!: string;
  @ApiProperty({ description: 'New value (string; ISO datetime for time fields).' })
  @IsString()
  @MaxLength(500)
  value!: string;
  @ApiProperty() @IsString() @MaxLength(1000) reason!: string;
}

export class AttendanceRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() employeeNumber!: string;
  @ApiProperty({ format: 'date' }) workDate!: string;
  @ApiProperty({ enum: ATTENDANCE_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) checkInAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) checkOutAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) gpsDistanceM!: string | null;
  @ApiProperty({ enum: ['WEB', 'MOBILE', 'ADMIN', 'IMPORT', 'INTEGRATION'] }) source!: string;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty() correctionCount!: number;
}

// ===================================================================
// Leave
// ===================================================================

const APPROVER_STRATEGIES = [
  'REPORTING_MANAGER',
  'HR',
  'DESIGNATED_APPROVER',
  'TENANT_ADMIN',
] as const;
const LEAVE_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

export class LeaveTypeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() isPaid!: boolean;
  @ApiProperty() requiresApproval!: boolean;
  @ApiProperty() allowNegativeBalance!: boolean;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: string;
  @ApiProperty({ nullable: true, type: Object }) policy!: {
    annualQuota: string;
    approverStrategy: string;
    designatedApproverMembershipId: string | null;
  } | null;
}

export class UpsertLeaveTypeDto {
  @ApiProperty() @IsString() @MaxLength(80) name!: string;
  @ApiProperty() @IsString() @MaxLength(30) code!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isPaid?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowNegativeBalance?: boolean;
  @ApiProperty({ example: '18.00' }) @Matches(/^\d+(\.\d{1,2})?$/) annualQuota!: string;
  @ApiPropertyOptional({ enum: APPROVER_STRATEGIES })
  @IsOptional()
  @IsIn(APPROVER_STRATEGIES as unknown as string[])
  approverStrategy?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  designatedApproverMembershipId?: string;
}

export class LeaveBalanceDto {
  @ApiProperty({ format: 'uuid' }) leaveTypeId!: string;
  @ApiProperty() leaveTypeName!: string;
  @ApiProperty() year!: number;
  @ApiProperty() opening!: string;
  @ApiProperty() accrued!: string;
  @ApiProperty() consumed!: string;
  @ApiProperty() adjusted!: string;
  @ApiProperty() balance!: string;
}

export class AdjustLeaveBalanceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() leaveTypeId!: string;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty({ description: 'Signed amount to add to the balance ledger.', example: '-2.00' })
  @Matches(/^-?\d+(\.\d{1,2})?$/)
  amount!: string;
  @ApiProperty() @IsString() @MaxLength(500) reason!: string;
}

export class CreateLeaveRequestDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'HR/managers only — omit for a self-service request.',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() leaveTypeId!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() startDate!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() endDate!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isHalfDay?: boolean;
  @ApiPropertyOptional({ enum: ['FIRST_HALF', 'SECOND_HALF'] })
  @IsOptional()
  @IsIn(['FIRST_HALF', 'SECOND_HALF'])
  halfDayPeriod?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class LeaveDecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class LeaveRequestDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() requestNumber!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() employeeNumber!: string;
  @ApiProperty({ format: 'uuid' }) leaveTypeId!: string;
  @ApiProperty() leaveTypeName!: string;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
  @ApiProperty() isHalfDay!: boolean;
  @ApiProperty({ nullable: true, type: String }) halfDayPeriod!: string | null;
  @ApiProperty() totalDays!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ enum: LEAVE_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) approverMembershipId!:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) approverName!: string | null;
  @ApiProperty({ nullable: true, type: String }) decisionReason!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) decidedAt!: string | null;
  @ApiProperty({
    description: 'The requester’s current balance for this leave type.',
    nullable: true,
    type: String,
  })
  availableBalance!: string | null;
  @ApiProperty() hasAttachment!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class LeaveCalendarItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty({ nullable: true, type: String }) department!: string | null;
  @ApiProperty() leaveTypeName!: string;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) endDate!: string;
  @ApiProperty() totalDays!: string;
  @ApiProperty({ enum: LEAVE_STATUSES }) status!: string;
}

// ===================================================================
// Expenses
// ===================================================================

const EXPENSE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'REIMBURSEMENT_PENDING',
  'REIMBURSED',
  'REIMBURSEMENT_FAILED',
  'CANCELLED',
] as const;

export class ExpenseCategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ nullable: true, type: String }) defaultMileageRate!: string | null;
  @ApiProperty() requiresReceipt!: boolean;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: string;
}

export class UpsertExpenseCategoryDto {
  @ApiProperty() @IsString() @MaxLength(80) name!: string;
  @ApiProperty() @IsString() @MaxLength(30) code!: string;
  @ApiPropertyOptional({ description: 'Set to make this a mileage category (distance × rate).' })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,4})?$/)
  defaultMileageRate?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() requiresReceipt?: boolean;
}

export class CreateExpenseClaimDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'HR/managers only — omit for self-service.' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() expenseDate!: string;
  @ApiProperty({ example: '850.00' }) @Matches(/^\d+(\.\d{1,2})?$/) amount!: string;
  @ApiPropertyOptional({ example: 'INR' }) @IsOptional() @Matches(ISO_CURRENCY) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) merchant?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Soft reference to a project (no FK).' })
  @IsOptional()
  @IsUUID()
  projectRef?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Soft reference to a field visit (no FK).' })
  @IsOptional()
  @IsUUID()
  visitRef?: string;
  @ApiPropertyOptional({ description: 'Mileage evidence, km.' })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/)
  distanceKm?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ExpenseDecisionDto {
  @ApiPropertyOptional({
    description: 'Approve for a lower amount (correction).',
    example: '800.00',
  })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/)
  approvedAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class RecordReimbursementDto {
  @ApiProperty({ example: '850.00' }) @Matches(/^\d+(\.\d{1,2})?$/) reimbursedAmount!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() paymentDate!: string;
  @ApiProperty({ enum: ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'] })
  @IsIn(['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'])
  paymentMethod!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) paymentReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) transactionRef?: string;
  @ApiPropertyOptional({ description: 'Set with FAILED to record a failed reimbursement.' })
  @IsOptional()
  @IsIn(['PAID', 'FAILED'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) failureReason?: string;
}

export class ExpenseReimbursementDto {
  @ApiProperty() reimbursedAmount!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date' }) paymentDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) paymentMethod!: string | null;
  @ApiProperty({ nullable: true, type: String }) paymentReference!: string | null;
  @ApiProperty({ nullable: true, type: String }) transactionRef!: string | null;
  @ApiProperty({ enum: ['PENDING', 'PAID', 'FAILED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) failureReason!: string | null;
}

export class ExpenseClaimDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() claimNumber!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() employeeNumber!: string;
  @ApiProperty() categoryName!: string;
  @ApiProperty({ format: 'date' }) expenseDate!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: String }) approvedAmount!: string | null;
  @ApiProperty({ nullable: true, type: String }) reimbursementAmount!: string | null;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) merchant!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) projectRef!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) visitRef!: string | null;
  @ApiProperty({ nullable: true, type: String }) distanceKm!: string | null;
  @ApiProperty({ enum: EXPENSE_STATUSES }) status!: string;
  @ApiProperty() hasReceipt!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) decidedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) decisionReason!: string | null;
  @ApiProperty({ nullable: true, type: ExpenseReimbursementDto })
  reimbursement!: ExpenseReimbursementDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

// ===================================================================
// Compensation & payroll
// ===================================================================

const COMPONENT_KINDS = ['EARNING', 'DEDUCTION', 'INCENTIVE', 'REIMBURSEMENT'] as const;

export class SalaryComponentInputDto {
  @ApiProperty({ enum: COMPONENT_KINDS })
  @IsIn(COMPONENT_KINDS as unknown as string[])
  kind!: string;
  @ApiProperty() @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ example: '5000.00' }) @Matches(/^\d+(\.\d{1,2})?$/) amount!: string;
}

export class CreateCompensationDto {
  @ApiProperty({ format: 'date' }) @IsISO8601() effectiveDate!: string;
  @ApiPropertyOptional({ enum: ['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL'] })
  @IsOptional()
  @IsIn(['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL'])
  payFrequency?: string;
  @ApiPropertyOptional({ example: 'INR' }) @IsOptional() @Matches(ISO_CURRENCY) currency?: string;
  @ApiProperty({ example: '50000.00' }) @Matches(/^\d+(\.\d{1,2})?$/) baseSalary!: string;
  @ApiPropertyOptional({ type: [SalaryComponentInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentInputDto)
  components?: SalaryComponentInputDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class CompensationComponentDto {
  @ApiProperty({ enum: COMPONENT_KINDS }) kind!: string;
  @ApiProperty() name!: string;
  @ApiProperty() amount!: string;
}

export class CompensationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date' }) effectiveDate!: string;
  @ApiProperty({ enum: ['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL'] }) payFrequency!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() baseSalary!: string;
  @ApiProperty({ enum: ['ACTIVE', 'SUPERSEDED'] }) status!: string;
  @ApiProperty({ type: [CompensationComponentDto] }) components!: CompensationComponentDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CreateIncentiveDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ example: '3000.00' }) @Matches(/^\d+(\.\d{1,2})?$/) amount!: string;
  @ApiPropertyOptional({ example: 'INR' }) @IsOptional() @Matches(ISO_CURRENCY) currency?: string;
  @ApiProperty({ example: 'performance', description: 'Free-text, tenant-defined.' })
  @IsString()
  @MaxLength(60)
  type!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) sourceRef?: string;
}

export class IncentiveDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ enum: ['DRAFT', 'APPROVED', 'REJECTED', 'PAID'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) payrollPeriodId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

const PAYROLL_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'FINALIZED',
  'PAYMENT_PROCESSING',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
] as const;

export class CreatePayrollPeriodDto {
  @ApiProperty({ example: 'September 2026' }) @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() periodStart!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() periodEnd!: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() payDate?: string;
  @ApiPropertyOptional({ example: 'INR' }) @IsOptional() @Matches(ISO_CURRENCY) currency?: string;
}

export class PayrollPeriodDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date' }) periodStart!: string;
  @ApiProperty({ format: 'date' }) periodEnd!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date' }) payDate!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PAYROLL_STATUSES }) status!: string;
  @ApiProperty() grossTotal!: string;
  @ApiProperty() deductionTotal!: string;
  @ApiProperty() incentiveTotal!: string;
  @ApiProperty() reimbursementTotal!: string;
  @ApiProperty() netTotal!: string;
  @ApiProperty() employeeCount!: number;
  @ApiProperty() paidCount!: number;
  @ApiProperty() pendingCount!: number;
  @ApiProperty() failedCount!: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) finalizedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PayrollEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeNumber!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() baseEarnings!: string;
  @ApiProperty() allowancesTotal!: string;
  @ApiProperty() incentivesTotal!: string;
  @ApiProperty() reimbursementsTotal!: string;
  @ApiProperty() deductionsTotal!: string;
  @ApiProperty() grossPay!: string;
  @ApiProperty() netPay!: string;
  @ApiProperty({ enum: ['PENDING', 'PAID', 'PARTIALLY_PAID', 'FAILED'] }) paymentStatus!: string;
  @ApiProperty() paidAmount!: string;
  @ApiProperty({ type: [CompensationComponentDto] }) components!: CompensationComponentDto[];
}

export class PayrollPeriodDetailDto extends PayrollPeriodDto {
  @ApiProperty({ type: [PayrollEntryDto] }) entries!: PayrollEntryDto[];
}

export class RecordPayrollPaymentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() payrollEntryId!: string;
  @ApiProperty({ example: '59650.00' }) @Matches(/^\d+(\.\d{1,2})?$/) amount!: string;
  @ApiProperty({ enum: ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'] })
  @IsIn(['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'])
  paymentMethod!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() paymentDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) paymentReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) transactionRef?: string;
  @ApiPropertyOptional({ enum: ['PAID', 'FAILED'] })
  @IsOptional()
  @IsIn(['PAID', 'FAILED'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) failureReason?: string;
}

export class PayrollHistoryItemDto {
  @ApiProperty() periodName!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date' }) payDate!: string | null;
  @ApiProperty() netPay!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['PENDING', 'PAID', 'PARTIALLY_PAID', 'FAILED'] }) paymentStatus!: string;
  @ApiProperty({ nullable: true, type: String }) paymentReference!: string | null;
  @ApiProperty({ format: 'uuid' }) payrollEntryId!: string;
}

// ===================================================================
// Performance
// ===================================================================

export class CreatePerformancePeriodDto {
  @ApiProperty({ example: 'H2 2026' }) @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() periodStart!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() periodEnd!: string;
}

export class CreateGoalDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() performancePeriodId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty() @IsString() @MaxLength(200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) weight?: number;
}

export class CreateReviewDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() performancePeriodId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) managerComments?: string;
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) managerComments?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) employeeComments?: string;
}

export class PerformancePeriodDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date' }) periodStart!: string;
  @ApiProperty({ format: 'date' }) periodEnd!: string;
  @ApiProperty({ enum: ['DRAFT', 'OPEN', 'CLOSED'] }) status!: string;
}

export class PerformanceGoalDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) performancePeriodId!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: Number }) weight!: number | null;
  @ApiProperty({ enum: ['OPEN', 'ACHIEVED', 'MISSED', 'CANCELLED'] }) status!: string;
}

export class PerformanceReviewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) performancePeriodId!: string;
  @ApiProperty() periodName!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty({ nullable: true, type: Number }) overallRating!: number | null;
  @ApiProperty({ nullable: true, type: String }) managerComments!: string | null;
  @ApiProperty({ nullable: true, type: String }) employeeComments!: string | null;
  @ApiProperty({ enum: ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'CLOSED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) submittedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

// ===================================================================
// Self-service + dashboard
// ===================================================================

export class HrMeDto {
  @ApiProperty({ type: EmployeeDetailDto }) employee!: EmployeeDetailDto;
  @ApiProperty({ type: [LeaveBalanceDto] }) leaveBalances!: LeaveBalanceDto[];
  @ApiProperty({ nullable: true, type: AttendanceRecordDto })
  todayAttendance!: AttendanceRecordDto | null;
}

export class HrDashboardDto {
  @ApiProperty() totalEmployees!: number;
  @ApiProperty() activeEmployees!: number;
  @ApiProperty() presentToday!: number;
  @ApiProperty() onLeaveToday!: number;
  @ApiProperty() absentToday!: number;
  @ApiProperty() pendingLeaveApprovals!: number;
  @ApiProperty() pendingExpenseApprovals!: number;
  @ApiProperty() departmentCount!: number;
  @ApiProperty({ nullable: true, type: Object })
  currentPayroll!: { id: string; name: string; status: string } | null;
}

// ---- generic paged wrappers -----------------------------------

export class EmployeeListDto {
  @ApiProperty({ type: [EmployeeListItemDto] }) items!: EmployeeListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class AttendanceListDto {
  @ApiProperty({ type: [AttendanceRecordDto] }) items!: AttendanceRecordDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class LeaveRequestListDto {
  @ApiProperty({ type: [LeaveRequestDto] }) items!: LeaveRequestDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class ExpenseClaimListDto {
  @ApiProperty({ type: [ExpenseClaimDto] }) items!: ExpenseClaimDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class IncentiveListDto {
  @ApiProperty({ type: [IncentiveDto] }) items!: IncentiveDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class PayrollPeriodListDto {
  @ApiProperty({ type: [PayrollPeriodDto] }) items!: PayrollPeriodDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

// ---- query DTOs ---------------------------------------------

export class ListEmployeesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() designationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() workLocationId?: string;
  @ApiPropertyOptional({ enum: EMPLOYEE_STATUSES })
  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES as unknown as string[])
  status?: string;
  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES as unknown as string[])
  employmentType?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListAttendanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ enum: ATTENDANCE_STATUSES })
  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES as unknown as string[])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListLeaveQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() leaveTypeId?: string;
  @ApiPropertyOptional({ enum: LEAVE_STATUSES })
  @IsOptional()
  @IsIn(LEAVE_STATUSES as unknown as string[])
  status?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListExpenseQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: EXPENSE_STATUSES })
  @IsOptional()
  @IsIn(EXPENSE_STATUSES as unknown as string[])
  status?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() visitRef?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListLeaveCalendarQueryDto {
  @ApiProperty({ format: 'date' }) @IsISO8601() from!: string;
  @ApiProperty({ format: 'date' }) @IsISO8601() to!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() leaveTypeId?: string;
}

export class ListPayrollQueryDto {
  @ApiPropertyOptional({ enum: PAYROLL_STATUSES })
  @IsOptional()
  @IsIn(PAYROLL_STATUSES as unknown as string[])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListIncentiveQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'APPROVED', 'REJECTED', 'PAID'] })
  @IsOptional()
  @IsIn(['DRAFT', 'APPROVED', 'REJECTED', 'PAID'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListPerformanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() performancePeriodId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() employeeId?: string;
}
