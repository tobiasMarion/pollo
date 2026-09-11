# Contracts

Everything that crosses a process boundary in Pollo, defined once. One Zod schema
carries the runtime validation, the TypeScript type inferred from it, and the
description that becomes the published API reference — so a message cannot be
documented one way and validated another.

```bash
npm test -w @pollo/contracts
```

## Layout

```
src/
  primitives/    the vocabulary the other three groups are written in
    geometry/      Vector3 and Origin, re-exported from @pollo/geometry
    location/      a GPS reading, accuracies included
    position/      a point in both frames, before and after the reconstruction
    union/         unionFrom / subsetOf — the derivation everything else rests on
  resources/     what REST serves
    event/         an event, as created, as persisted, and as a client receives it
    graph/         nodes, edges, what is known about each device, participants
    user/          a Pollo account
  effects/       a cue, and what every client must make of it
    schemas/       the record every effect derives from
    presets/       the deck the panel fires from
    preview/       brightness and delay — wire semantics, not a panel detail
  socket/        the WebSocket protocol
    schemas/       every frame, keyed by its own type
    directions/    the four named subsets, so a socket rejects what it cannot receive
    docs/          the published message table, rendered from the same record
    parse/         JSON plus validation, without throwing
    endpoints/     the two socket paths and the application close codes
  streams/       Redis stream messages plus the keys for recoverable current state
```

A module is a directory: `index.ts`, with `test.ts` beside it where there is
behaviour worth pinning. The groups say what a thing is *for* — vocabulary, a
REST resource, one of the two live protocols — which is the question you have
when you are looking for where something belongs.

**The exported surface is flat.** `index.ts` re-exports every module, so
consumers import `@pollo/contracts` and nothing else; the grouping is how the
package is written, not how it is read.

## Where the boundaries actually are

`position/` is a primitive and `graph/` is a resource, and the split is not
cosmetic. A position travels on the socket to every client and on the stream from
the worker; the graph is a snapshot the panel fetches once and then follows with
deltas. Nothing that carries a position needs to know a graph exists.

`effects/preview` computes brightness and delay and lives here rather than in the
panel for the same reason: a cue is a name and a handful of numbers, and it means
nothing without the arithmetic that turns it into light. Every client has to do
that arithmetic identically, so it is part of the contract.

Pure maths that no boundary depends on lives in
[`packages/geometry`](../geometry) instead. `Vector3` and `Origin` are declared
there and re-exported from `primitives/geometry`, because a coordinate is a
mathematical object before it is a message field — and `vector3Schema` says
`satisfies` against that type rather than inventing its own.

## Records, not member lists

The unions are built from records by `unionFrom`, so adding a message or an
effect is a single entry: the union, the type inferred from it, the key list, the
per-direction subsets, the deck and the documented table all follow. One cast
lives in `primitives/union` and nowhere else.

That is what the tests are mostly about — that the derivation holds. Every effect
is described, every message is keyed by its own type, the four directions cover
every message exactly once, and no direction lets a client send what only the
server emits.
