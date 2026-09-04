import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../security/security.decorators.js';
import { HealthService } from './health.service.js';
import { HealthReportDto, LivenessReportDto } from './health.dto.js';

/**
 * Infrastructure health — deployment/orchestration probes. Deliberately
 * `@Public()`: it must not require session authentication or a tenant context
 * (CLAUDE.md / task 11).
 */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ operationId: 'getLiveness', summary: 'Liveness probe. No dependency checks.' })
  @ApiOkResponse({ type: LivenessReportDto, description: 'Process is alive.' })
  liveness(): LivenessReportDto {
    return { status: 'ok', uptimeSeconds: this.health.livenessUptimeSeconds() };
  }

  @Get()
  @ApiOperation({
    operationId: 'getHealth',
    summary: 'Readiness health check (database + redis).',
  })
  @ApiOkResponse({ type: HealthReportDto, description: 'Readiness report.' })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<HealthReportDto> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') {
      res.status(503);
    }
    return report as HealthReportDto;
  }
}
