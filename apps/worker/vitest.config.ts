import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*test.ts'],
        },
      },
      {
        /**
         * What `ioredis-mock` does not model. Its `XREAD` ignores the cursor it
         * is given, so every assertion about *where a read starts* passes or
         * fails for reasons that have nothing to do with this code — and where a
         * read starts is the whole difference between a worker that replays an
         * event's history and one that follows it.
         *
         * Needs `just up`. Runs on Redis logical db 15, like the backend tiers
         * keep off db 0.
         */
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 15_000,
        },
      },
    ],
  },
})
