# Pollo

> Sync a million fireflies.

Pollo monorepo. Greenfield restart — see [ADR 0001](docs/adr/0001-greenfield-monorepo.md).

## Structure

```
apps/
  backend/     TypeScript API (minimal for now; grows step by step)
  # web/       admin panel (SvelteKit)          — phase 2
  # worker/    position estimation (Rust)       — phase 3 (rewritten by hand)
  # mobile/    sensor client (SwiftUI/iOS)
infra/         Docker Compose and Dockerfiles
docs/adr/      architecture decision records
```

## Development

Prerequisites: Node ≥20 (npm), Docker, and optionally [`just`](https://github.com/casey/just).

```bash
npm install
cp .env.example .env
just up                       # starts Postgres + Redis (not used by the API yet)
just dev                      # API on the host with hot-reload  ->  http://localhost:3333/health
```

No `just`? The equivalent commands are in the [`justfile`](justfile).
