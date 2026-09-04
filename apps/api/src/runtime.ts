/**
 * True when the process was started only to emit the OpenAPI document
 * (`pnpm --filter @aivoryx/api openapi:extract`). In that mode the app is
 * created but never listens, and no external connection (DB / Redis / queues)
 * should be opened, so contract generation works offline and in CI.
 */
export function isOpenApiGeneration(): boolean {
  return process.env.OPENAPI_GENERATION === '1';
}
