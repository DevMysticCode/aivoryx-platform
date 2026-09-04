import { ApiProperty } from '@nestjs/swagger';

export class LivenessReportDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ example: 1234 })
  uptimeSeconds!: number;
}

export class DependencyHealthDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ example: 12 })
  latencyMs!: number;

  @ApiProperty({ required: false, nullable: true, type: String })
  detail?: string | null;
}

export class HealthChecksDto {
  @ApiProperty({ type: DependencyHealthDto })
  database!: DependencyHealthDto;

  @ApiProperty({ type: DependencyHealthDto })
  redis!: DependencyHealthDto;
}

export class HealthReportDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ example: 'AIV-01J9Z8ABCDEF0123456789' })
  correlationId!: string;

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}
