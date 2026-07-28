import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './test-env.js';

/**
 * Integration/e2e tests run against dedicated resources (pollo_test database,
 * Redis logical db 1) so they can never clobber dev data. Requires the dev
 * datastores from infra/compose.dev.yaml to be up.
 */
export default async function setup() {
  const admin = new PrismaClient({
    datasourceUrl: TEST_DATABASE_URL.replace('/pollo_test', '/pollo'),
  });

  try {
    await admin.$executeRawUnsafe('CREATE DATABASE pollo_test');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already exists')) throw error;
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  const redis = new Redis(TEST_REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
