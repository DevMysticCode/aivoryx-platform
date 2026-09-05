import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSourceRequestDto {
  @ApiProperty({ maxLength: 60, example: 'website-pabbly' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  key!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: { type: 'string' },
    description:
      'Provider field -> "canonical:<field>" | "custom:<key>" | "skip" overrides, merged over the built-in defaults.',
  })
  @IsOptional()
  @IsObject()
  fieldMapping?: Record<string, string>;
}

export class SourceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['pabbly_bridge'] })
  connectorType!: string;

  @ApiProperty({ enum: ['active', 'revoked'] })
  status!: string;

  @ApiProperty({ type: Object, additionalProperties: true })
  fieldMapping!: Record<string, string>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class SourceSecretHandoffDto {
  @ApiProperty({
    description:
      'One-time connector secret. Returned ONLY here (create / rotate); send it to Pabbly as the ' +
      '"Authorization: Bearer <secret>" header. Never returned again.',
  })
  secret!: string;
}

export class CreateSourceResponseDto {
  @ApiProperty({ type: SourceDto })
  source!: SourceDto;

  @ApiProperty({ type: SourceSecretHandoffDto })
  credential!: SourceSecretHandoffDto;
}

export class CanonicalEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  rawEventId!: string;

  @ApiProperty({ format: 'uuid' })
  sourceId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  leadId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  dedupeOutcome!: string | null;

  @ApiProperty()
  processingAttempts!: number;

  @ApiProperty({ nullable: true, type: String })
  lastErrorCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastErrorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IngestAcceptedResponseDto {
  @ApiProperty()
  accepted!: boolean;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'uuid' })
  rawEventId!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  canonicalEventId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  leadId?: string;

  @ApiProperty({ required: false })
  dedupeOutcome?: string;

  @ApiProperty({ required: false })
  errorCode?: string;

  @ApiProperty({ required: false })
  errorMessage?: string;
}
