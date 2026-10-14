import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globalSetup: ['test/globalSetup.ts'],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
