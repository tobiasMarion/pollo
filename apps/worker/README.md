# Worker

Turning a graph of distances into positions is a simulation, and a simulation
has no business on an event loop. This is the process that does it: it reads the
graph as it changes, works out where everybody is standing, and publishes the
answer back. The API only does IO.

```bash
just worker        # needs `just up` for Redis
```

## What crosses the boundary

Only positions. No brightness, no effects, no cues — a device works out its own
light from where it is standing, and none of that reasoning lives here.

The whole boundary is written down once, in
[`packages/contracts/src/wire.ts`](../../packages/contracts/src/wire.ts):

| stream | direction | what |
|---|---|---|
| `events:control` | API → worker | `EVENT_OPENED` with the event's origin, `EVENT_CLOSED` |
| `event:<id>:ingest` | API → worker | one entry per 250 ms window: arrivals, departures, GPS reports, measured distances |
| `event:<id>:positions` | worker → API | `delta` for what moved, `keyframe` for everything, periodically |

Control is read **from the beginning**. There are two entries per event in the
lifetime of the system, so replaying is cheap, and folding opened-against-closed
tells a worker that has just started which events are live without asking
anybody. Ingest is read **from now**: whatever it still holds is a window that
was already applied to a graph this process does not have.

## It does not know the simulator exists

`apps/simulator` emulates a crowd, and this worker is measured against it. That
is a bench, not a dependency. Nothing here imports from it, and no number here
is justified by what that generator produces — a solver tuned to one noise model
has been tuned to one noise model. What this worker assumes about a measurement
it assumes about measurement in general, and the rest it estimates from the data
in front of it.

## What it does today

**Nothing yet.** `estimate()` returns each device's own GPS reading, projected
into the event's frame.

That is deliberate, and it is not a placeholder in the usual sense. The path is
real end to end — the stream arrives, the graph is maintained, positions go out,
the panel draws pixels — while the numbers are still the control. When the solver
lands, it replaces one method, and the accuracy it buys is measured against this
line rather than against nothing.

## Layout

```
src/
  config/    env and logger — the subset of the repo's .env this process uses
  redis/     one blocking read across every stream, and the publisher
  events/    which events are live, and the tick that solves each one
  ingest/    the graph, as ops arrive
  publish/   what changed since last time, and the four coordinates the wire wants
```

**Devices live in slots, not in a map.** Every number the solver will keep about
a device — where it is, where its GPS puts it, how much evidence it has absorbed
— is one flat array indexed the same way, and a slot freed by a departure goes
to the next arrival. Ids only appear at the edges: coming in from the stream,
going out on the wire.

**One read, not one per event.** `XREAD BLOCK` monopolises its socket, so a
blocking read per event would be a connection per event doing nothing. A single
read over every followed key costs one connection whatever the crowd does.
