# io — talking to the world

Argv, the API, the socket each device holds, and the terminal. Everything with a
side effect lives here; the other four modules are pure enough to test without a
network.

## Contents

- [The config table](#the-config-table)
- [The device](#the-device) — one emulated phone
- [Reaching the API](#reaching-the-api)
- [The dashboard](#the-dashboard)

## The config table

`config.ts` is one record from which three things derive: the usage text, the
`parseArgs` option table, and the Zod schema. A new knob is one entry rather
than three edits that drift apart, and `--help` cannot go stale because it is
generated from the same source that validates.

Validation fails on the first bad value with the message Zod wrote, in the
spirit of the API's `env.ts`. A load test that starts and then misbehaves is
worse than one that refuses to start.

`--help` short-circuits validation deliberately: it has to work without a
`--event`, which is exactly when someone is reading it.

## The device

One emulated phone: a seat in the stand, a receiver that lies about where it is,
a radio that lies about how far its neighbours are, and a socket.

### It owns no timer

Twenty thousand `setInterval`s would cost more than the work they schedule. The
shard ticks every device on one clock and each device decides whether anything
is due.

Report and distance schedules are **phase-jittered on connect**. Without that,
twenty thousand devices report on the same millisecond and the run measures a
thundering herd rather than the API.

### Walking, not teleporting

A device that relocates interpolates over twelve seconds rather than jumping. A
jump would move every distance to every neighbour within a single sample, which
no sensor produces and no filter should have to survive.

A new seat means a new sky and a new set of reflecting surfaces, so the GNSS
model is rebuilt rather than carried over.

### Retracting edges

A device tracks which peers it has told the server about. Anything previously
reported and no longer in range is explicitly retracted with a `null` distance
— otherwise the graph keeps an edge to someone who walked away, and nothing
later removes it.

This is also why `null` is sent when a measurement exceeds `--max-edge`: the
peer was heard before and is not being heard usefully now, which is a retraction
and not silence. See [`noise/README.md`](../noise/README.md#two-limits-and-they-are-not-the-same-limit).

### Leaving versus dropping

`phase` is set to `away` *before* the socket is closed. The close handler reads
it to tell a deliberate departure from a dropped connection, and only the latter
should reconnect immediately — a device that meant to leave reconnecting at once
would make churn invisible.

## Reaching the API

`--event` names an already-open event. Nothing is created: `GET /events/:eventId`
is public, so the origin comes back with no token and the load-test path needs no
credentials at all.

The lookup retries. `just simulate` builds the contracts package first, which
restarts a watching API — so the simulator's own invocation is the most likely
cause of the connection it fails on. Giving up there would make the tool fail
for a reason it created itself.

## The dashboard

A braille chart, hand-rolled, with no new dependency. Braille gives 2×4
addressable dots per character cell, which is eight times the vertical
resolution of a block-drawing approach for the same terminal width.

**Two lines, always.** On its own the worker's error means nothing; raw GPS
given identical treatment is the control, and the gap between them is what the
worker is worth. See [the top-level README](../../README.md#reading-a-run).

`--json` swaps the dashboard for NDJSON, for when the run is being recorded
rather than watched.
