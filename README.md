# Pollo

> Sync a million fireflies.

Pollo monorepo. Greenfield restart — see [ADR 0001](docs/adr/0001-greenfield-monorepo.md)
and [ADR 0002](docs/adr/0002-api-rebuild.md).

## Structure

```
apps/
  backend/     Fastify + TypeScript API (REST + WebSockets, Prisma/Postgres, Redis)
  # web/       admin panel (SvelteKit)          — phase 2
  # worker/    position estimation (Rust)       — phase 3 (rewritten by hand)
  # mobile/    sensor client (SwiftUI/iOS)
infra/         Docker Compose (dev + prod) and Dockerfiles
docs/adr/      architecture decision records
```

## Development

Prerequisites: Node ≥20 (npm), Docker, and optionally [`just`](https://github.com/casey/just).

```bash
npm install
cp .env.example .env          # fill JWT_SECRET and the GitHub OAuth credentials
just up                       # Postgres + Redis
just migrate                  # apply Prisma migrations
just dev                      # API on the host with hot-reload  ->  http://localhost:3333/docs
```

### Tests

```bash
just test                     # unit (no external dependencies)
npm run test:integration -w @pollo/backend   # needs `just up`
npm run test:e2e -w @pollo/backend           # needs `just up`
npm run test:all -w @pollo/backend
```

Integration and e2e run against a dedicated `pollo_test` database and Redis
logical db 1 — they never touch dev data.

## Production

One VPS, one command. Fill the secrets in `.env`, then:

```bash
just prod-build
just prod-up                  # API on :3333; migrations applied on boot
```

Postgres and Redis stay internal to the compose network; only the API is
published. `just prod-logs` and `just prod-down` do what they say.

Without `just`, every command lives in the [`justfile`](justfile).
