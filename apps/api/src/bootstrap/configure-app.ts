import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
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
