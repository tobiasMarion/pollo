import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './test-env.js';

/**
 * Integration/e2e tests run against dedicated resources (pollo_test database,
 * Redis logical db 1) so they can never clobber dev data. Requires the dev
 * datastores from infra/compose.dev.yaml to be up.
 */
export default async function setup() {
  const admin = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: TEST_DATABASE_URL.replace('/pollo_test', '/pollo'),
    }),
  });

  try {
    // Postgres has no CREATE DATABASE IF NOT EXISTS, and letting it fail would
    // leave an ERROR line in the server log on every run.
    const [existing] = await admin.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = 'pollo_test'`;

    if (!existing) {
      await admin.$executeRawUnsafe('CREATE DATABASE pollo_test');
    }
  } finally {
    await admin.$disconnect();
  }

  // --url pins the target database explicitly — never trust env precedence
  // when the alternative is truncating the dev database by accident.
  execSync(`npx prisma db push --url "${TEST_DATABASE_URL}"`, {
    stdio: 'pipe',
  });

  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
