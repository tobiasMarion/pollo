import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          setupFiles: ['./test/setup-env.ts'],
          globalSetup: ['./test/global-setup.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          setupFiles: ['./test/setup-env.ts'],
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 15_000,
        },
      },
    ],
  },
});
