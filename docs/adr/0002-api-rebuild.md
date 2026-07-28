# ADR 0002 — API rebuilt in the monorepo

- **Status:** accepted
- **Date:** 2026-07-28

## Context

The Fastify API from the legacy `pollo-backend` repo was migrated into
`apps/backend`, preserving its route surface and wire contracts while fixing
structural problems (import-time side effects, silent WS failures, no
shutdown path, dead simulation code).

## Decisions

- **No import-time IO.** Clients and the event registry are wired through
  Fastify plugins/decorators; `EventRegistry.boot()` rehydrates OPEN events on
  `onReady`, and everything tears down on `onClose`.
- **Transport behind the `Bus` port** (per ADR 0001), with `RedisStreamsBus`
  as the default implementation. Positions subscriptions snapshot their stream
  baseline at subscribe time — `$` would race the connection handshake and
  silently drop early messages.
- **Graph store writes are serialized per event.** They stay off the hot path,
  but apply in dispatch order (a `removeEdge` must never overtake its
  `setEdge`).
- **typedSql was dropped** in favor of `$queryRaw` + Zod row validation: the
  preview feature requires a live database at `prisma generate` time, which
  would poison the Docker build.
- **`prisma` is a production dependency** so the runtime image can generate
  the client and run `migrate deploy` at container startup.
- **Admin sockets get `AUTHENTICATION_ACK`**, giving clients a reliable
  signal that report messages will flow.
- **Left behind on purpose:** `services/graph/draw/*` (simulation belongs to
  the Rust worker), `@tensorflow/tfjs`, `seedrandom`, and the ESLint/Prettier
  stack (Biome covers both).

## Consequences

- `docker compose --env-file .env -f infra/compose.prod.yaml up` gives a
  production-ready stack (API + Postgres + Redis, healthchecked, migrations
  applied on boot).
- Test pyramid: unit (schemas/runtime), integration (REST against a dedicated
  `pollo_test` database), e2e (real server + WS clients + simulated worker).
