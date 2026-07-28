import { defineConfig, env } from 'prisma/config';

// Prisma no longer auto-loads .env. Pull in the repo root one when present so
// bare `npx prisma ...` / npm lifecycle scripts work in dev; explicitly set
// variables (tests, Docker) are not overridden. env() resolves at config load,
// so even `prisma generate` needs DATABASE_URL — the Docker build stage sets a
// placeholder for that reason.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);
} catch {
  // no .env — the environment must provide the variables
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
