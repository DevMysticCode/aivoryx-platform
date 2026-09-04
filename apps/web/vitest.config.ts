import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['{app,components,lib}/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
  },
});
