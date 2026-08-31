import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `folder/index.ts` beside `folder/test.ts`: the test sits next to what it
    // tests without a directory ever holding two files per subject.
    include: ['src/**/test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The barrel re-exports and declares nothing; the fixtures are the tests.
      exclude: ['src/**/test.ts', 'src/**/fixtures/**', 'src/index.ts'],
      thresholds: {
        /**
         * Every function in here is exercised, and that is the whole point of
         * the package existing: maths that needs half an application around it
         * to run is maths nobody checks.
         *
         * The branch floor is low and deliberately not a target.
         * `noUncheckedIndexedAccess` turns every read of a typed array into
         * `arr[i] ?? 0`, and the `??` side of each of those is unreachable by
         * construction — a `Float64Array` does not return undefined inside its
         * own length. They are most of the branches in the package, so the
         * number says almost nothing about how well it is tested; the floor is
         * here to catch a suite that stopped running, not to be chased.
         */
        functions: 100,
        lines: 100,
        statements: 100,
        branches: 55,
      },
    },
  },
})
