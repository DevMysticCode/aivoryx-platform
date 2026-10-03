import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppError } from '@aivoryx/shared';
import { Public } from '../security/security.decorators.js';
import { getCorrelationId, newCorrelationId } from '../observability/correlation.js';
import { extractBearerSecret } from './connector-token.js';
import { IngestionService } from './ingestion.service.js';
import { IngestAcceptedResponseDto } from './integrations.dto.js';

/**
 * The inbound connector transport (ADR 0032, UC-3/ADR 0050). `@Public()` because there is no user
 * session here at all — a BEARER-style provider (Pabbly) authenticates with its connector secret; a
 * SIGNATURE-style provider (Meta) authenticates via `ConnectorAdapter.verify()` on the raw body, and
 * has no bearer secret at all (its platform cannot send a custom Authorization header). Either way
 * the tenant is derived server-side; the payload's own `tenant_id` (if any) is never read for
 * routing. Both routes below share one implementation — neither contains provider-specific logic.
 */
@ApiTags('integrations')
@Controller('integrations/webhooks')
export class WebhookController {
  constructor(private readonly ingestion: IngestionService) {}

  /** Backward-compatible alias (ADR 0032) — identical behaviour to the universal route below. */
  @Post('pabbly/:sourceKey')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'ingestPabblyWebhook',
    summary:
      'Inbound Pabbly-relayed lead. Authenticate with "Authorization: Bearer <connector secret>".',
  })
  @ApiOkResponse({ type: IngestAcceptedResponseDto })
  async ingestPabbly(
    @Param('sourceKey') sourceKey: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IngestAcceptedResponseDto> {
    return this.handle(sourceKey, authorization, body, req, res);
  }

  /**
   * Provider-neutral entry point (UC-3, ADR 0050). The source's `connector_type` decides which
   * adapter handles it; this controller never branches on provider. A bearer-style source still
   * needs its `Authorization` header here; a signature-style source (Meta) needs none — its
   * connector is authenticated entirely by `ConnectorAdapter.verify()` against the raw body.
   */
  @Post(':sourceKey')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'ingestWebhook',
    summary: 'Inbound connector event. Provider-neutral entry point for any configured source.',
  })
  @ApiOkResponse({ type: IngestAcceptedResponseDto })
  async ingest(
    @Param('sourceKey') sourceKey: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IngestAcceptedResponseDto> {
    return this.handle(sourceKey, authorization, body, req, res);
  }

  /**
   * Meta's one-time webhook subscription handshake (`hub.mode=subscribe`), deliberately a SEPARATE
   * endpoint from the POST pipeline above — it never touches ingestion, never persists anything, and
   * is excluded from the public OpenAPI document (Meta calls it directly, by URL, from the App
   * Dashboard; it is not part of the connector's documented API surface).
   */
  @Get(':sourceKey/handshake')
  @Public()
  @ApiExcludeEndpoint()
  async handshake(
    @Param('sourceKey') sourceKey: string,
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      res.status(403);
      return '';
    }
    const ok = await this.ingestion.verifyWebhookHandshake(sourceKey, verifyToken);
    if (!ok) {
      res.status(403);
      return '';
    }
    return challenge;
  }

  private async handle(
    sourceKey: string,
    authorization: string | undefined,
    body: unknown,
    req: Request,
    res: Response,
  ): Promise<IngestAcceptedResponseDto> {
    const correlationId = getCorrelationId() ?? newCorrelationId();
    let result;
    try {
      result = await this.ingestion.ingest({
        sourceKeyFromUrl: sourceKey,
        secret: extractBearerSecret(authorization),
        rawBody: body,
        rawBytes: (req as Request & { rawBody?: Buffer }).rawBody,
        headers: safeHeaders(req),
        correlationId,
      });
    } catch (err) {
      // 429 carries Retry-After (seconds) so well-behaved senders back off
      if (AppError.isAppError(err) && err.code === 'RATE_LIMITED') {
        const retryAfter = err.details?.retryAfterSeconds;
        if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
      }
      throw err;
    }
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
  const keep = ['content-type', 'user-agent', 'x-correlation-id', 'x-hub-signature-256'];
  const out: Record<string, string> = {};
  for (const key of keep) {
    const value = req.headers[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}
