# Pollo

> Sync a million fireflies.

Pollo monorepo. Greenfield restart — see [ADR 0001](docs/adr/0001-greenfield-monorepo.md),
[ADR 0002](docs/adr/0002-api-rebuild.md) and [ADR 0004](docs/adr/0004-admin-panel.md).

## Structure

```
apps/
  backend/     Fastify + TypeScript API (REST + WebSockets, Prisma/Postgres, Redis)
  web/         admin panel (SvelteKit + Tailwind)
  # worker/    position estimation (Rust)       — phase 3 (rewritten by hand)
  # mobile/    sensor client (SwiftUI/iOS)
packages/
  contracts/   the wire, as Zod schemas — every client validates against these
infra/         Docker Compose (dev + prod) and Dockerfiles
docs/adr/      architecture decision records
```

Everything that crosses a process boundary is defined once, in
`packages/contracts` ([ADR 0005](docs/adr/0005-shared-contracts.md)). The schemas
there carry the validation, the TypeScript types inferred from them, and the
descriptions that become the API reference — and the lists are derived, so adding
an effect or a message is one entry rather than a hunt through both apps.

Both apps import the package's **build output**, so it compiles before they do.
`just dev`, `just web` and `just test` take care of that; when contracts is what
you are editing, `just contracts-watch` in another shell keeps it fresh.

## Development

Prerequisites: Node ≥20 (npm), Docker, and optionally [`just`](https://github.com/casey/just).

```bash
npm install
cp .env.example .env          # fill JWT_SECRET and the GitHub OAuth credentials
just up                       # Postgres + Redis
just migrate                  # apply Prisma migrations
just dev                      # API on the host with hot-reload  ->  http://localhost:3333/docs
just web                      # admin panel, in another shell    ->  http://localhost:3000
```

The panel signs in with the same GitHub OAuth app as the API, so the app's
**Authorization callback URL** must be exactly `GITHUB_OAUTH_CLIENT_REDIRECT_URI`
(`http://localhost:3000/api/auth/callback` in development). Port 3000 is part of
that contract — the dev server refuses to move.

### Tests

```bash
just test                     # unit (no external dependencies)
npm run test:integration -w @pollo/backend   # needs `just up`
npm run test:e2e -w @pollo/backend           # needs `just up`
npm run test:all -w @pollo/backend
```

Integration and e2e run against a dedicated `pollo_test` database and Redis
logical db 1 — they never touch dev data.

CI (GitHub Actions) runs the same pipeline on every PR — Biome, typecheck of
both apps, the panel build, migrations, all three test tiers — plus a job that
builds the production image and boots the full stack against its healthcheck.

## Production

One VPS, one command. Fill the secrets in `.env`, then:

```bash
just prod-build
just prod-up                  # API on :3333, panel on :3000
```

Migrations are applied on boot and the panel waits for the API to be healthy.
Postgres and Redis stay internal to the compose network; only the API and the
panel are published. `just prod-logs` and `just prod-down` do what they say.

Two addresses matter and they are not the same one: `PUBLIC_POLLO_API_URL` is
what the operator's browser uses, WebSocket included, while the panel's own
server reaches the API inside the network at `http://api:3333`. `WEB_ORIGIN`
must be the address the panel is served from, or form posts are rejected.

Without `just`, every command lives in the [`justfile`](justfile).
