import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { API_V1_PREFIX } from '@aivoryx/contracts';

/** Build the code-first OpenAPI document (ADR 0005). */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Aivoryx Platform API')
    .setDescription('Code-first OpenAPI contract. Regenerate with `pnpm contracts:generate`.')
    .setVersion('1.0.0')
    .addServer(API_V1_PREFIX)
    .addCookieAuth('aivoryx_session', {
      type: 'apiKey',
      in: 'cookie',
      name: 'aivoryx_session',
      description: 'HTTP-only session cookie (ADR 0010). Set by the auth endpoints in Phase 2.',
    })
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}

/** Mount Swagger UI + the raw document at `/api/v1/docs`. */
export function setupSwaggerUi(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup('api/v1/docs', app, document, {
    jsonDocumentUrl: 'api/v1/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
}
