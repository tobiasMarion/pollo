# ADR 0003 — Prisma 7

- **Status:** accepted
- **Date:** 2026-07-28

## Context

The API shipped on Prisma 6 (ADR 0002). Prisma 7 removes the Rust query
engine in favor of a TypeScript client with driver adapters, moves CLI
connection config out of the schema into `prisma.config.ts`, and generates
the client as plain TypeScript into the source tree.

## Decisions

- **`prisma.config.ts`** owns the datasource URL (`env('DATABASE_URL')`).
  `env()` resolves at config load — even `prisma generate` needs the variable,
  so the Docker build stage sets a placeholder. The config loads the repo root
  `.env` when present (explicitly set variables win).
- **Generator `prisma-client`** outputs to `apps/backend/src/generated/prisma`
  (git-ignored; recreated by `predev`/`prebuild` hooks). The generated client
  is compiled by tsc into `dist` like any other source — the runtime Docker
  stage no longer runs `prisma generate`.
- **`@prisma/adapter-pg`** provides the connection (`PrismaPg({ connectionString })`
  passed to `new PrismaClient({ adapter })`). `@prisma/client` remains a
  dependency: the generated code imports its runtime.
- **Test bootstrap uses `db push --url`** to pin the target database
  explicitly instead of trusting environment precedence — misresolution there
  would truncate the dev database.

## Consequences

- No native engines: smaller image, no openssl requirement, no engine
  downloads on install.
- The Prisma VS Code extension (v7 generation) no longer flags the schema.
