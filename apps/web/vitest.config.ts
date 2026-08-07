import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Playwright specs live in test/e2e and must not be collected by Vitest --
    // the two runners' `test`/`expect` globals are not interchangeable.
    exclude: ['node_modules/**', 'test/e2e/**', '.next/**'],
  },
});
