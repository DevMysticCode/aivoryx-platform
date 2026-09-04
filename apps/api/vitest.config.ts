import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS DI needs `design:paramtypes` metadata, which esbuild (vitest's default
  // transform) does not emit. SWC does.
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    globalSetup: ['./test/global-setup.ts'],
    clearMocks: true,
    // Integration specs (`*.int.spec.ts`, gated on RUN_DB_IT) boot a Nest app
    // and share one database — run test files serially.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
