# ADR 0005 — Shared contracts package

- **Status:** accepted
- **Date:** 2026-07-30

## Context

ADR 0001 planned a contracts package and deferred it; ADR 0004 shipped the panel
with the wire shapes retyped by hand in `apps/web/src/lib/api/types.ts`, its own
header admitting the debt. Two clients of one protocol, and no single place that
said what the protocol was.

The duplication was the visible half of the problem. The other half was that the
lists were written out even where a machine could derive them: the message union
restated its twelve members, the effect union its four, the OpenAPI descriptions
restated both in prose, and the panel's deck restated the effect names a third
time. Adding an effect meant touching five files in two apps and finding out at
runtime which one was missed.

## Decisions

- **`packages/contracts` (`@pollo/contracts`)**, a third workspace. The npm
  `workspaces` array grows a `packages/*` entry; `apps/*` stays as it was.
- **Zod is the mechanism, not just the validator.** One schema yields the runtime
  check, the inferred TypeScript type, and — through `.describe()` and
  `fastify-type-provider-zod` — the published documentation. Nothing is typed
  next to a schema that describes the same thing.
- **Records, not member lists.** `unionFrom(discriminator, record)` builds a
  discriminated union out of a record of schemas, so the union, the inferred
  type and the key list all follow from one entry. Messages, effects and both
  Redis Streams unions are built this way. One cast lives in `union.ts` and
  nowhere else.
- **Direction sets over one big union.** `adminOutbound`, `adminInbound`,
  `deviceOutbound` and `deviceInbound` are named subsets of the message record.
  Each socket now validates only what it can receive, so a `JOIN` on the admin
  socket closes with `4400` instead of falling through a `default:` branch. The
  panel gets its inbound type from the same subset for free.
- **Effects are a registry**: schemas, the deck of presets, and the delay and
  brightness math live together. The math is a `Record<EffectName, …>` rather
  than a `switch`, and so is the panel's canvas wavefront — a new effect does
  not compile until both are answered. Everything else (the deck, its number-key
  shortcuts, socket validation, the documented list of names) is derived.
- **The socket documentation is rendered from the registry.** `messageTable()`
  turns a direction set plus each schema's `.describe()` into the markdown table
  that Scalar shows. Hand-written tables drift on the first change; derived ones
  cannot.
- **The package ships built JavaScript**, not TypeScript source. The API is
  compiled by plain `tsc` and run with `node dist/server.js`; `tsc` leaves a bare
  specifier alone, so `@pollo/contracts` is resolved at runtime through the npm
  workspace symlink and has to be real JS on the other side.
- **No TypeScript project references.** They would force `tsc -b` on the API and
  still leave the panel — `svelte-check` and Vite know nothing about references —
  needing explicit ordering. Every entry point builds contracts explicitly
  instead: root `build`/`typecheck`/`test`, the `contracts` recipe the `dev`,
  `web` and `test` targets depend on, one CI step, and both Dockerfiles.
- **The panel bundles the package.** Its production image ships the adapter-node
  output and nothing else, so `ssr.noExternal` names `@pollo/contracts` and the
  dependency is declared as a devDependency, keeping it off the externals list.

## Consequences

- Adding an effect is one entry in `effectSchemas`, one in the preview record,
  one in the canvas record, and as many presets as wanted. The panel's deck, the
  API's validation and the published documentation follow with no further edits.
- The panel validates inbound frames with the shared schema instead of casting
  `JSON.parse`, so a frame it cannot read is dropped rather than rendered.
- The API's `src/schemas/` directory is gone; the wire lives in one package and
  the backend imports it like any other dependency.
- Hot-reload survives the indirection, which was not obvious: both apps consume
  the build output, but the workspace symlink resolves to `packages/contracts/dist`
  — a real path outside `node_modules` — so `tsx watch` restarts the API on it and
  Vite invalidates its SSR module. With `just contracts-watch` running, editing a
  contract propagates to both without a manual restart on either side.
  `just all` starts that watch alongside them.
- Zod is pinned to one range across all three workspaces. Two copies would break
  the `instanceof ZodError` branch in the API's error handler silently.
- The Rust worker (ADR 0001, phase 3) gets a written boundary to mirror with
  serde: `wire.ts` is now the only place that describes it.
