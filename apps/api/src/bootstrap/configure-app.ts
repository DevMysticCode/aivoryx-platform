import type { IncomingMessage, ServerResponse } from 'node:http';
import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import helmet from 'helmet';
import type { ServerEnv } from '@aivoryx/config';
import { correlationRequestHandler } from '../observability/correlation.middleware.js';
import { requestMetaRequestHandler } from '../observability/request-context.js';

/**
 * All cross-cutting HTTP setup in one place so `main.ts` and tests configure the
 * app identically. Routes end up under `/api/v1/*` (global prefix + URI
 * versioning, ADR 0005).
 */
export function configureApp(app: INestApplication, env: ServerEnv): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Correlation id first, so every downstream log/error carries it.
  app.use(correlationRequestHandler);
  // Safe request metadata (ip / user-agent / request id) for the audit log.
  app.use(requestMetaRequestHandler);
  // Public inbound webhooks get their OWN, explicit body limit (WEBHOOK_MAX_BODY_BYTES). Mounted
  // before the framework's default parsers, so an oversized request is rejected by the parser
  // itself (413 PAYLOAD_TOO_LARGE, decided from Content-Length or while streaming) and never
  // reaches the controller, the database or any queue. Every other route keeps the default limit.
  // `verify` captures the EXACT bytes received, before JSON parsing, onto `req.rawBody` (UC-3,
  // ADR 0050) — needed by a provider whose signature (Meta's `X-Hub-Signature-256`) is computed
  // over the raw body and would not survive a JSON.parse/JSON.stringify round-trip. Bounded by the
  // same WEBHOOK_MAX_BODY_BYTES limit as everything else on this path, held only for the life of the
  // request (never persisted), and read by nothing except `WebhookController`'s signature check.
  const webhookParserOptions = {
    limit: env.WEBHOOK_MAX_BODY_BYTES,
    verify: (req: IncomingMessage & { rawBody?: Buffer }, _res: ServerResponse, buf: Buffer) => {
      req.rawBody = buf;
    },
  };
  app.use(
    '/api/v1/integrations/webhooks',
    bodyParser.json(webhookParserOptions),
    bodyParser.urlencoded({ ...webhookParserOptions, extended: true }),
  );
  app.use(helmet());
  app.use(cookieParser());

  // Credentialed CORS: only the explicitly allow-listed browser origins.
  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();
}
