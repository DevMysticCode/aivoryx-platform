import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ---- shared -------------------------------------------------------------

export class LeadContactDto {
  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({ required: false, maxLength: 320 })
  @IsOptional()
  @IsString()
  @MaxLength(320)
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

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: true,
    description: 'Tenant custom-field values, keyed by field key.',
  })
  @IsOptional()
  customFields?: Record<string, string | number | boolean | null>;
}

export class LeadAssigneeDto {
  @ApiProperty({ format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class LeadDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  sourceId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  sourceName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

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

  @ApiProperty({ enum: ['NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'] })
  status!: string;

  @ApiProperty({ type: LeadAssigneeDto, nullable: true })
  assignee!: LeadAssigneeDto | null;

  @ApiProperty({ nullable: true, type: String })
  qualificationNote!: string | null;

  @ApiProperty({ type: Object, additionalProperties: true })
  customFields!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class LeadListResponseDto {
  @ApiProperty({ type: [LeadDto] })
  items!: LeadDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class AssignLeadRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  membershipId!: string;
}

export class LeadStatusRequestDto {
  @ApiProperty({ enum: ['ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'] })
  @IsIn(['ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'])
  status!: 'ASSIGNED' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED' | 'CONVERTED';
}

export class QualifyLeadRequestDto {
  @ApiProperty({ enum: ['QUALIFIED', 'DISQUALIFIED'] })
  @IsIn(['QUALIFIED', 'DISQUALIFIED'])
  outcome!: 'QUALIFIED' | 'DISQUALIFIED';

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CallAttemptRequestDto {
  @ApiProperty({ example: 'connected', maxLength: 40 })
  @IsString()
  @MaxLength(40)
  outcome!: string;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ---- activities / notes ---------------------------------------------

export class LeadActivityDto {
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

export class CreateNoteRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class NoteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  leadId!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  authorMembershipId!: string | null;

  @ApiProperty()
  body!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

// ---- follow-ups -------------------------------------------------------

export class CreateFollowupRequestDto {
  @ApiProperty({ required: false, format: 'uuid', description: 'Defaults to the caller.' })
  @IsOptional()
  @IsString()
  assignedMembershipId?: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  dueAt!: string;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CompleteFollowupRequestDto {
  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  result?: string;
}

export class RescheduleFollowupRequestDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  dueAt!: string;
}

export class FollowupDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  leadId!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  assignedMembershipId!: string | null;

  @ApiProperty({ format: 'date-time' })
  dueAt!: string;

  @ApiProperty({ enum: ['pending', 'completed', 'cancelled'] })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ nullable: true, type: String })
  result!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt!: string | null;
}

// ---- custom fields ------------------------------------------------

export class CreateCustomFieldRequestDto {
  @ApiProperty({ maxLength: 60, example: 'roof_type' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  key!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: ['text', 'number', 'boolean', 'date', 'select'] })
  @IsIn(['text', 'number', 'boolean', 'date', 'select'])
  dataType!: 'text' | 'number' | 'boolean' | 'date' | 'select';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiProperty({ required: false, type: [String], description: 'Required for `select` fields.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

export class CustomFieldDefinitionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: ['text', 'number', 'boolean', 'date', 'select'] })
  dataType!: string;

  @ApiProperty()
  isRequired!: boolean;

  @ApiProperty({ type: [String], nullable: true })
  options!: string[] | null;

  @ApiProperty({ enum: ['active', 'deprecated'] })
  status!: string;
}

// ---- pagination / filters (query params, no decorators needed here) ----

export class ListLeadsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  assignedMembershipId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  q?: string;

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
