import { defineConfig } from 'vitest/config';

// S2 must never inherit the production root vitest.config.ts or its dependencies.
export default defineConfig({
  root: __dirname,
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    watch: false,
  },
});
