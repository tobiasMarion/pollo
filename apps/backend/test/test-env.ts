export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pollo:pollo@localhost:5432/pollo_test?schema=public'

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1'
