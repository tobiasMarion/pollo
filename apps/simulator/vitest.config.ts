import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * These suites are statistical: they draw tens of thousands of samples to
     * assert a stationary sigma or an autocorrelation, which is the only honest
     * way to test a noise model. Several seconds each is the cost of that, and
     * eight files running in parallel on a loaded CI box push the slowest well
     * past the 5s default — a timeout there is a scheduling artefact, not a
     * regression.
     */
    testTimeout: 60_000,
  },
})
