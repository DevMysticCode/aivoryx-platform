import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // mirrors tsconfig `paths` ("@/*" -> "./*") so components that import via the alias are testable
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['{app,components,lib}/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
  },
});
