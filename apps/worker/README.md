# Worker

Turning a graph of distances into positions is a least-squares reconstruction,
and that has no business on an event loop. This is the process that does it: it
reads the graph as it changes, works out where everybody is standing, and
publishes the answer back. The API only does IO.

```bash
just worker        # needs `just up` for Redis
```

## What crosses the boundary

Only positions. No brightness, no effects, no cues — a device works out its own
light from where it is standing, and none of that reasoning lives here.

The whole boundary is written down once, in
[`packages/contracts/src/streams`](../../packages/contracts/src/streams):

| stream | direction | what |
|---|---|---|
| `events:control` | API → worker | `EVENT_OPENED` with the event's origin, `EVENT_CLOSED` |
| `event:<id>:ingest` | API → worker | one entry per 250 ms window: arrivals, departures, GPS reports, measured distances |
| `event:<id>:positions` | worker → API | `delta` for what moved, `keyframe` for everything, periodically |

Both streams are read **from now**, after their cursors have been captured. The
worker then hydrates open events and their current graphs from Redis hashes and
starts consuming. A mutation racing startup is either in that snapshot or after
the cursor, and every recovered operation is idempotent. Streams therefore stay
bounded and describe change; state hashes describe what survived before this
process arrived. The ordering is recorded in
[`ADR 0007`](../../docs/adr/0007-recover-live-state-from-snapshots.md).

## What it does

Metric multidimensional scaling, solved by Guttman majorization. The objective is

```
S(X) = Σ_i wa_i·‖x_i − g_i‖²  +  Σ_ij w_ij·(‖x_i − x_j‖ − d_ij)²
```

— a soft spring from each device to its own GPS reading, plus one spring per
measured distance whose rest length is that measurement, each weighted by one
over its variance. That is the Gaussian maximum likelihood estimate, and each
sweep exactly minimises a function that sits above it and touches it at the
current answer, so the objective cannot go up. There is no step size, no
stiffness and no time step, which is the whole reason to prefer this to springs.

Four things sit on top of that, and each of them was measured rather than chosen:

- **In place and over-relaxed.** Gauss–Seidel rather than Jacobi, so information
  crosses the graph within one sweep, and each device thrown `omega` times as far
  as the transform asks. Together, at eight sweeps on a crowd of a hundred and
  twenty: 2.56 m of error became 1.90 m at identical cost.
- **Soft GPS anchors, per axis, that never fade.** A fix good to five metres
  across the ground is routinely twelve metres out in height, so horizontal and
  vertical are weighted apart. Fading them as a device gathers evidence scores
  *worse* — 2.56 m to 2.93 m — because the anchors are the only thing fixing the
  frame.
- **A robust loss.** Past the knee a residual counts linearly instead of
  quadratically, as an IRLS weight, so a reflection or a wall cannot drag its
  neighbourhood after it.
- **The sensor, estimated.** `sigma(d) = floor + relative·d` is a premise about
  the form of ranging error; the numbers come from the residuals the solve is
  already producing, by medians and two halves rather than a regression.

Published positions are a running mean over windows rather than the latest
answer. `alpha = 1/n` is not an approximation of that mean, it is that mean — one
counter per device, no history kept — with a floor that turns it into an
exponential average, which is the only reason a device whose owner walks away is
ever followed.

The maths itself is not here. It lives in
[`packages/geometry`](../../packages/geometry), where it can be tested without
half an application around it; what is here is the IO, the graph, and the
decisions about devices and events that the maths must not know about.

## It does not know the simulator exists

`apps/simulator` emulates a crowd, and this worker is measured against it. That
is a bench, not a dependency. Nothing here imports from it, and no number here
is justified by what that generator produces — a solver tuned to one noise model
has been tuned to one noise model. The two now share a random number generator
and a matrix decomposition through `@pollo/geometry`, and nothing else: every
tuning constant stays on its own side.

## Layout

```
src/
  main.ts        the entry point, and nothing else
  composition/   the one place anything is constructed
  config/        env and logger — the subset of the repo's .env this process uses
  redis/         one blocking read, current-state recovery, and the publisher
  events/        which events are live, and the tick that solves each one
  ingest/        slots, edges, and the graph that applies ops to both
  publish/       what changed since last time, and the four coordinates the wire wants
  solve/         the arrays the solve lives in, and the tick that drives it
```

Every module is a directory with an `index.ts` and, where there is behaviour
worth pinning, a `test.ts` beside it.

**Nothing constructs its own collaborators.** `Solver` takes the sweep and the
sensor fit as functions, `LiveEvent` takes its graph, ledger and solver
assembled, and `EventRegistry` takes a factory rather than learning what an event
is made of. `composition/` is the only file that says `new` more than once, and
it is the only file that reads `Env`.

**Devices live in slots, not in a map.** Every number the solver keeps about a
device — where it is, where its GPS puts it, what its own reading is worth, how
much evidence it has absorbed — is one flat array indexed the same way, and a
slot freed by a departure goes to the next arrival. Ids only appear at the edges:
coming in from the stream, going out on the wire.

**One read, not one per event.** `XREAD BLOCK` monopolises its socket, so a
blocking read per event would be a connection per event doing nothing. A single
read over every followed key costs one connection whatever the crowd does.

## Tests

```bash
npm test -w @pollo/worker              # the unit tier
npm run test:integration -w @pollo/worker   # needs `just up`
```

The unit tier covers what the worker decides: startup recovery, the graph as ops
arrive, the publishing rules, the sweep budget and the per-window blend, and the
reconstruction itself against scenarios written here rather than drawn from the
simulator. The integration tier covers what `ioredis-mock` gets wrong about
`XREAD`, which happens to be exactly where a read starts.

Every mathematical function the worker calls is tested in
[`packages/geometry`](../../packages/geometry), under a coverage gate.
