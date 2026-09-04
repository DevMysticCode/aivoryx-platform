import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { loadServerEnv } from '@aivoryx/config';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap/configure-app.js';
import { buildOpenApiDocument, setupSwaggerUi } from './bootstrap/openapi.js';

async function bootstrap(): Promise<void> {
  const env = loadServerEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(PinoLogger);
  app.useLogger(logger);
  app.flushLogs();

  configureApp(app, env);
  setupSwaggerUi(app, buildOpenApiDocument(app));

  // Belt-and-braces graceful shutdown: Nest shutdown hooks close DI lifecycle
  // providers (DB pool, Redis, BullMQ). This just makes the intent explicit and
  // covers signals on all platforms.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.log(`API listening on http://0.0.0.0:${env.API_PORT}/api/v1 (env: ${env.APP_ENV})`);
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal: API failed to start');
  console.error(err);
  process.exit(1);
});
