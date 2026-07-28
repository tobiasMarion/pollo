import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

export async function createTestApp() {
  const app = await buildApp({ env: loadEnv() });
  await app.ready();
  return app;
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export async function truncateDatabase(app: TestApp) {
  await app.prisma.$executeRawUnsafe('TRUNCATE TABLE "events", "accounts", "users" CASCADE');
}

export async function createUser(app: TestApp, email = `user-${Date.now()}@test.dev`) {
  const user = await app.prisma.user.create({
    data: { name: 'Test User', email },
  });

  return { user, token: app.jwt.sign({ sub: user.id }) };
}

export async function waitFor<T>(
  probe: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  { timeoutMs = 5000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();
    if (predicate(value)) return value;

    if (Date.now() > deadline) {
      throw new Error(
        `waitFor timed out after ${timeoutMs}ms; last value: ${JSON.stringify(value)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
