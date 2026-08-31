import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `folder/index.ts` beside `folder/test.ts`: the test sits next to what it
    // tests without a directory ever holding two files per subject.
    include: ['src/**/test.ts'],
  },
})
