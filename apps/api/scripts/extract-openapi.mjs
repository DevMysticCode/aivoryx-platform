/**
 * Emit the code-first OpenAPI document to
 * `packages/contracts/openapi/openapi.json` without starting the HTTP server or
 * opening any external connection.
 *
 * Runs against the BUILT output (`dist/`) — same module graph as `main.js` — so
 * decorator metadata is stable. `pnpm --filter @aivoryx/api openapi:extract`
 * (turbo builds first).
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.OPENAPI_GENERATION = '1';
// Minimal env so @aivoryx/config validation passes in CI without a real .env.
process.env.DATABASE_URL ||= 'postgres://openapi:openapi@localhost:5432/openapi';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.SESSION_SECRET ||= 'x'.repeat(40);

const here = path.dirname(fileURLToPath(import.meta.url));
const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../dist/app.module.js');
const { buildOpenApiDocument } = await import('../dist/bootstrap/openapi.js');

const outFile = path.resolve(here, '../../../packages/contracts/openapi/openapi.json');

const app = await NestFactory.create(AppModule, { logger: false });
const document = buildOpenApiDocument(app);
await app.close();

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.warn(`OpenAPI document written to ${outFile}`);
process.exit(0);
