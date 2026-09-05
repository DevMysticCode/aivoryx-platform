import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../security/security.decorators.js';
import { getCorrelationId, newCorrelationId } from '../observability/correlation.js';
import { extractBearerSecret } from './connector-token.js';
import { IngestionService } from './ingestion.service.js';
import { IngestAcceptedResponseDto } from './integrations.dto.js';

/**
 * The one real inbound connector this phase ships (ADR 0032). Provider-neutral
 * transport: `@Public()` because there is no user session here at all — the
 * connector's bearer secret is the entire authentication boundary, and the
 * tenant is derived from it server-side. The payload's own `tenant_id` (if
 * any) is never read for routing.
 */
@ApiTags('integrations')
@Controller('integrations/webhooks')
export class WebhookController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('pabbly/:sourceKey')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'ingestPabblyWebhook',
    summary:
      'Inbound Pabbly-relayed lead. Authenticate with "Authorization: Bearer <connector secret>".',
  })
  @ApiOkResponse({ type: IngestAcceptedResponseDto })
  async ingest(
    @Param('sourceKey') sourceKey: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<IngestAcceptedResponseDto> {
    const correlationId = getCorrelationId() ?? newCorrelationId();
    const result = await this.ingestion.ingest({
      sourceKeyFromUrl: sourceKey,
      secret: extractBearerSecret(authorization),
      rawBody: body,
      headers: safeHeaders(req),
      correlationId,
    });
    return {
      accepted: true,
      status: result.status,
      rawEventId: result.rawEventId,
      canonicalEventId: result.canonicalEventId,
      leadId: result.leadId,
      dedupeOutcome: result.dedupeOutcome,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  }
}

/** Headers worth keeping for diagnostics — never the Authorization value itself. */
function safeHeaders(req: Request): Record<string, string> {
  const keep = ['content-type', 'user-agent', 'x-correlation-id'];
  const out: Record<string, string> = {};
  for (const key of keep) {
    const value = req.headers[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}
