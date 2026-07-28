# ADR 0001 — Greenfield restart as a monorepo

- **Status:** accepted
- **Date:** 2026-07-27

## Context

The Pollo system ("sync a million fireflies") was spread across ~6 sibling
repositories with inconsistent naming (`pollo-*` and `sparkle*` are the same
project): Fastify/TS backend, Rust worker, Next web, SwiftUI mobile, an explainer
and a legacy Svelte web app. The bus between backend and worker was hand-rolled
`XADD`/`XREAD`, with no consumer group and no ack — best-effort, no delivery
guarantee.

## Decision

Restart from scratch as a single **monorepo** (`pollo/`), applying the accumulated
learning, keeping the old repositories **intact as reference** (no git history
migration; nothing deleted).

- Canonical name: **pollo**.
- Package manager: **npm workspaces** (`apps/*`). _(Revised on 2026-07-28 —
  originally pnpm workspaces with `packages/*`; simplified to npm and the bare
  minimum of structure, growing step by step.)_
- Order: API → admin (SvelteKit) → simulation pipelines → observability → prod docker.
- Production deploy: **VPS + Docker Compose**.

## Boundaries

- The **Rust worker is rewritten by hand by the owner** (it is the core; they want
  line-by-line mastery). Assistance = teaching/reviewing, not generating.
- The **message transport sits behind a port** (`Bus`); the broker choice
  (NATS JetStream / RSMQ / RabbitMQ / hardened Redis Streams) is deferred to the
  simulation phase. Redis stays as state/cache regardless.

## Consequences

- Contracts (stream and API schemas) get a single source of truth in a shared
  contracts package, eliminating the backend↔worker duplication. _(Deferred by
  the 2026-07-28 revision; comes back when the worker lands.)_
- Reproducible dev environment via Compose (datastores) + hot-reload on the host.
