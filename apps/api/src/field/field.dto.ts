import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ---- field agents --------------------------------------------------------

export class DesignateFieldAgentRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  membershipId!: string;
}

export class FieldAgentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ nullable: true, type: String })
  userName!: string | null;

  @ApiProperty({ format: 'email' })
  userEmail!: string;

  @ApiProperty({ enum: ['active', 'inactive'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

// ---- visits ---------------------------------------------------------------

export class ScheduleVisitRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  leadId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  scheduledAt!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  assignedMembershipId?: string;

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

  @ApiProperty({ required: false, description: 'Known site latitude — no geocoding is performed.' })
  @IsOptional()
  @IsLatitude()
  siteLat?: number;

  @ApiProperty({
    required: false,
    description: 'Known site longitude — no geocoding is performed.',
  })
  @IsOptional()
  @IsLongitude()
  siteLng?: number;
}

export class AssignVisitRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  membershipId!: string;
}

export class RescheduleVisitRequestDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  scheduledAt!: string;
}

export class CancelVisitRequestDto {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class GeoPointRequestDto {
  @ApiProperty()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({ required: false, description: 'Device-reported accuracy in metres.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyM?: number;
}

export class CheckOutRequestDto extends GeoPointRequestDto {
  @ApiProperty({ required: false, description: 'Operator-entered travel distance, in km.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  travelKm?: number;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  travelNotes?: string;
}

export class SubmitSurveyRequestDto {
  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description: 'Survey field values, keyed by the visit custom-field key.',
  })
  @IsObject()
  values!: Record<string, string | number | boolean | null>;
}

export class VisitAssigneeDto {
  @ApiProperty({ format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class VisitDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  leadId!: string;

  @ApiProperty({ nullable: true, type: String })
  leadName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  leadPhone!: string | null;

  @ApiProperty({ enum: ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  scheduledAt!: string;

  @ApiProperty({ nullable: true, type: String })
  addressLine!: string | null;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;

  @ApiProperty({ nullable: true, type: String })
  state!: string | null;

  @ApiProperty({ nullable: true, type: String })
  postalCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  country!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  siteLat!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  siteLng!: number | null;

  @ApiProperty({ type: VisitAssigneeDto, nullable: true })
  assignee!: VisitAssigneeDto | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  checkInAt!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  checkInLat!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  checkInLng!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  checkInAccuracyM!: number | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  checkOutAt!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  checkOutLat!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  checkOutLng!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  checkOutAccuracyM!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Straight-line metres, not road distance.',
  })
  gpsDistanceMeters!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  travelKm!: number | null;

  @ApiProperty({ nullable: true, type: String })
  travelNotes!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  surveyCompletedAt!: string | null;

  @ApiProperty({ format: 'uuid' })
  createdByMembershipId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class VisitListResponseDto {
  @ApiProperty({ type: [VisitDto] })
  items!: VisitDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class ListVisitsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  leadId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  assignedMembershipId?: string;

  @ApiProperty({ required: false, description: 'Only visits scheduled today.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  today?: boolean;

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

export class VisitActivityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  actorMembershipId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  actorName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  actorEmail!: string | null;

  @ApiProperty({ type: Object, additionalProperties: true })
  payload!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class SurveyFieldValueDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: ['text', 'number', 'boolean', 'date', 'select'] })
  dataType!: string;

  @ApiProperty()
  isRequired!: boolean;

  @ApiProperty({ type: [String], nullable: true, description: 'Required for `select` fields.' })
  options!: string[] | null;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    nullable: true,
  })
  value!: string | number | boolean | null;
}

// ---- notes ------------------------------------------------------------

export class CreateVisitNoteRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class VisitNoteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  authorMembershipId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  authorName!: string | null;

  @ApiProperty()
  body!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

// ---- attachments --------------------------------------------------------

export class VisitAttachmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ nullable: true, type: String })
  originalFilename!: string | null;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  uploadedByMembershipId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

// ---- field → HR expense claim (Phase 12, ADR 0041) ---------------------
// The Field module never touches HR tables. This request is forwarded through
// the narrow `ExpensesService.createFromFieldVisit` capability; the employee is
// resolved server-side from the caller's authenticated membership.

export class CreateFieldExpenseClaimRequestDto {
  @ApiProperty({ format: 'uuid', description: 'HR expense category (e.g. Fuel / Travel).' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ format: 'date', example: '2026-09-06' })
  @IsISO8601()
  expenseDate!: string;

  @ApiProperty({ example: '640.00', description: 'Claimed amount (money, 2dp).' })
  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @ApiProperty({ required: false, example: 'INR' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  merchant?: string;

  @ApiProperty({
    required: false,
    example: '18.50',
    description: 'Mileage evidence in km — used only if the category has a mileage rate.',
  })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/)
  distanceKm?: string;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ required: false, default: true, description: 'Submit immediately for approval.' })
  @IsOptional()
  @IsBoolean()
  autoSubmit?: boolean;
}
