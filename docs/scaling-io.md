# Where the IO goes

Nobody is going to lend this project a crowd. Three thousand people in a room is
not a test anyone can arrange twice, let alone fifty thousand, so the simulator
is the only audience Pollo will ever have — and the number it can reach is the
only honest statement the project can make about how far it scales.

The target is 50,000 simulated phones against one API process on one machine.
This document is the audit that came out of asking whether that is reachable.
The short answer is that the current protocol tops out around two to five
thousand, and that the ceiling is not the event loop being slow: it is a handful
of places where the cost of one device joining, leaving, or speaking is
proportional to how many other devices exist. Fix those and the same machine has
a real chance at 50,000.

Every figure below is derived from the simulator's own defaults, so they are the
numbers a run actually produces rather than a worst case invented to make a
point.

## The budget

With `--clients 50000` and the defaults from `apps/simulator/src/io/config.ts`
(`report-hz 1`, `distance-hz 0.5`, `neighbors 8`, `churn 0.005`,
`blackout 0.01`, `ramp 60`):

| what | rate |
| --- | --- |
| `LOCATION_UPDATE` in | 50,000/s |
| `DISTANCE` in | 200,000/s |
| **total frames in** | **250,000/s** |
| devices dropping out (churn + blackout) | 12.5/s |
| devices coming back | 12.5/s |
| joins during the 60 s ramp | 833/s |

Churn and blackout are quoted per minute over the whole crowd, so 1.5% of 50,000
is 750 disconnections a minute — one every 80 ms, forever. That steady trickle is
what turns three O(n) operations into the thing that decides the ceiling. The
ramp is worse but temporary; the churn never stops.

---

## 1. The roster hands every joining device the entire crowd

*`apps/backend/src/http/routes/events/get-participants.ts`,
`EventService.getSubscribers`*

A device opens its socket, sends `JOIN`, and then reads `/participants` to learn
who is already here. That route answers with every connected device and its last
known location — all 50,000 of them, one `Participant` object each.

Serialised, that response is on the order of 8 MB. At 12.5 joins a second it is
roughly 100 MB/s of JSON produced by a single-threaded process, and the ramp is
worse: 50,000 devices each reading a roster that averages half the crowd works
out to something near 200 GB of serialisation before the run has even reached a
steady state. Before any of that reaches the socket, `getSubscribers()` has
allocated a fresh array of 50,000 objects, so the garbage collector is being fed
a few hundred megabytes a second on top.

The route is not doing anything wasteful for the size of crowd it was written
for. The problem is what it is being asked for: a device wants to know *who it
can measure*, and it is being handed *everyone who exists*. Those are the same
answer at 500 devices and wildly different answers at 50,000, because a phone can
only range against peers within about six metres of it.

**Fix.** The roster becomes local. A joining device gets the peers near it, not
the crowd — which is section 12, since the same change fixes the next problem
too.

## 2. `USER_JOINED` is a broadcast to everyone

*`EventService.subscribe` / `unsubscribe`,
`apps/backend/src/events/event-service.ts:190`*

`subscribe` calls `broadcastToDevices`, which walks the subscriber map and sends
one frame per connection. So does `unsubscribe`. The cost of one device arriving
is therefore proportional to how many devices are already there, and the cost of
the whole crowd arriving is proportional to the square of it.

During the ramp that is 833 joins a second against a map that grows to 50,000
entries: an average of 20 million frames a second, 40 million by the time the
last device arrives, and 1.25 billion frames over the ramp as a whole. Those are
not numbers a process approaches and misses; they are numbers that mean the ramp
never finishes.

The steady state is the part that is easy to overlook. Churn and blackout produce
25 lifecycle events a second between them, and each one is a full broadcast:
**1.25 million frames a second, permanently**, which is five times the entire
inbound message rate. The crowd stops growing and the fan-out does not stop.

`USER_JOINED` exists for a real reason — a device cannot range against a peer it
has never heard of, and with UWB that message is what carries the discovery
token. But of the 50,000 devices told about an arrival, roughly 340 are close
enough to ever measure it. Better than 99% of that traffic is information the
receiver has no use for, and the project is paying O(n) per event to deliver it.

**Fix.** Section 12.

## 3. Removing a node walks the whole graph

*`GraphStore.removeNode`, `apps/backend/src/events/graph-store.ts:119`*

This is the most expensive operation in the system and the least visible one.

Edges are stored per source node, in a hash keyed by destination:
`graph:<id>:edges:<from>` maps `to → distance`. That layout answers "who did this
device measure?" in one command and cannot answer "who measured this device?" at
all. So when a device leaves, `removeNode` reads the entire node set with
`SMEMBERS` and issues an `HDEL` against *every* node's edge hash, on the chance
that one of them holds an edge pointing at the departing device.

At 50,000 nodes that is one `SMEMBERS` returning 50,000 members plus a pipeline
of 50,000 `HDEL`s — per departure. At 12.5 departures a second it is 625,000
Redis commands a second and 12.5 full reads of a 50,000-member set, to delete
something like eight edges. The graph store is doing O(n) work to undo O(1)
worth of state, and since every device eventually leaves, the run pays O(n²)
overall.

**Fix.** Keep a reverse index. Alongside `edges:<from>`, write
`edges_in:<to>` — a set of the nodes that hold an edge pointing at this one,
updated in `setEdge` and `removeEdge`. Departure then reads that set, deletes
those specific fields, and drops both keys: work proportional to the device's
degree, which is bounded by `--neighbors`, rather than to the size of the crowd.
Roughly eight commands instead of fifty thousand.

The reverse index costs one extra `SADD` per new edge and one `SREM` per
retraction, which is real but constant, and section 4 removes most of that cost
anyway.

## 4. The graph store is written once per message, synchronously in fan-out order

*`GraphStore.setNodeLocation` / `setEdge`,
`EventService.enqueueStoreWrite`*

Every inbound message queues a Redis write, and each of those writes is several
commands:

- `setNodeLocation` is `HGET` → parse → `HSET` → `EXPIRE`. Three round trips per
  `LOCATION_UPDATE`, and the `HGET` is there only to preserve the `position`
  field while overwriting `location`.
- `setEdge` calls `addNode(from)` and `addNode(to)` — two `SADD`s and two
  `EXPIRE`s — then `HSET` and `EXPIRE`. Six commands per `DISTANCE`.

Multiply out: 50,000/s × 3 plus 200,000/s × 6 is **1.35 million commands a
second**, before the reverse-index work from section 3 and before the `XADD`s
from section 5. A single-threaded Redis manages somewhere around a million simple
operations a second under aggressive pipelining, and this is a local instance
sharing a machine with the API and the simulator. The store alone is over budget.

The writes are correctly kept off the hot path — `enqueueStoreWrite` chains them
into a promise nobody awaits — but that only means the API does not block on
them. It does not mean they are free. A queue that receives work faster than it
drains is not a queue, it is a leak, and the promise chain grows until the
process runs out of memory.

Three separate fixes apply, in increasing order of ambition.

**Fix, cheap.** Stop the read-modify-write. Store `location` and `position` as
separate hash fields rather than one JSON blob, and `setNodeLocation` becomes a
single `HSET`. Drop the per-operation `EXPIRE`: a TTL refreshed once a minute per
event keeps the same guarantee for four orders of magnitude less traffic. Remove
the `addNode` calls from `setEdge` — the node was added when the device
subscribed, and those calls are what caused the resurrection bug documented on
`setDistanceToDevice`. That takes 1.35M commands a second down to about 250,000.

**Fix, better.** Batch. The store does not owe anyone a per-message write; it
owes a correct picture whenever something reads it. Accumulate mutations in
memory and flush a pipeline every 20 ms or so, collapsing repeats by key on the
way — a device that reported its location twice in one window only needs the
second one written. This is exactly what `AdminDigest` already does for the
panel, applied to Redis.

**Fix, honest.** Ask what the store is for. Its own header says: REST reads and
worker hydration. But the worker gets the truth from the ingest stream, and
`/participants` and `/graph` are already served from the in-memory connection map
because the queued writes lag. The authoritative copy of this data is the
`subscribers` map in the process. The Redis copy is a snapshot for a worker that
starts late, and a snapshot can be written periodically instead of continuously.

## 5. One `XADD` per mutation

*`RedisStreamsBus.publishIngest`, `apps/backend/src/events/bus.ts:48`*

Every graph mutation is published to the ingest stream as its own stream entry:
250,000 `XADD`s a second, each carrying a JSON object of a few dozen bytes. The
call is fire-and-forget and the ordering guarantee it needs is per-event, not
per-message, so nothing about the design requires one entry per mutation. It just
happens to be the simplest thing to write.

Redis pays a fixed cost per command — parsing the protocol, allocating the entry,
updating the radix tree, waking the blocked reader — and at this rate that fixed
cost is most of the work. The payloads are small enough that the framing
dominates them.

**Fix.** Coalesce. Buffer mutations and emit one `XADD` per event every ~20 ms
with a JSON array as its field value: 250,000 commands a second becomes about 50,
with the same bytes moved and one wake-up per batch instead of thousands. The
worker's read loop changes from "one entry, one mutation" to "one entry, a list",
which is a smaller change than it sounds and lets it amortise its own locking the
same way.

While in there: `ioredis` does not enable auto-pipelining by default.
`enableAutoPipelining: true` in `apps/backend/src/plugins/redis.ts` batches
commands issued in the same tick into one write, which is worth several times the
throughput on its own and costs one line.

## 6. Every inbound frame is validated with Zod

*`safeParseJsonMessage`, called per message in
`apps/backend/src/http/ws/join-event.ts:21`*

Each of the 250,000 frames a second is `JSON.parse`d and then run through a
discriminated union schema. Zod is the right tool for the contract — ADR 0005
makes that case well, and the documentation and types that fall out of it are not
something to give up — but a discriminated union parse costs on the order of
microseconds, and 250,000 × 3 µs is **0.75 seconds of CPU per second of
wall-clock**. One core, saturated, doing nothing but confirming that messages
look the way they always look.

**Fix.** Split the protocol by frequency rather than validating it uniformly.
Handshake frames — `JOIN`, the admin socket's auth — keep full Zod validation;
they happen once per connection and their failure modes are the interesting ones.
High-frequency data frames get a hand-written check: switch on `type`, then
verify the two or three fields that matter. The schemas stay in contracts as the
single source of truth for types and documentation; only the runtime path for hot
frames is specialised, next to a test asserting it accepts exactly what the
schema accepts.

If the wire eventually goes binary (section 8), this disappears entirely — there
is no JSON to parse and the field layout is the validation.

## 7. `DISTANCE` is one frame per peer

*`VirtualDevice.sweepDistances`, `apps/simulator/src/io/device.ts:439`; the
contract in `packages/contracts/src/messages`*

A sweep measures eight peers and sends eight separate WebSocket frames. Each one
pays a frame header, a `send` call, a socket write, a parse and a validate on the
other side — for a payload of a device id and one number.

Eighty per cent of the inbound message rate is this. 200,000 of the 250,000
frames a second are single distance readings that were produced together, in the
same loop iteration, on the same millisecond.

**Fix.** Add a `DISTANCES` message carrying an array: one frame per sweep instead
of eight. Inbound drops from 250,000 frames a second to 75,000, and every
per-frame cost in the system — `ws` framing, `JSON.parse`, Zod, the `XADD` —
drops by the same factor.

Then cut what is sent at all. A crowd standing still produces distances that do
not change; the simulator faithfully re-sends them anyway. Report a reading only
when it has moved more than the ranging noise floor (10 cm is a reasonable
starting point), and send `LOCATION_UPDATE` only when the position has drifted
beyond the accuracy the device is claiming. In a seated venue that removes most
of what remains. This costs nothing architecturally — it is the client deciding
what is worth saying — and it is the highest-leverage change in this document
relative to its size.

## 8. Fan-out serialises once per recipient

*`sendMessage`, `apps/backend/src/http/ws/protocol.ts:4`*

`socket.send(JSON.stringify(message))` is fine for one socket and wrong for a
broadcast: the same object is stringified once per recipient, and each `send`
produces its own frame with its own header and its own write. `ws` does masking
and framing in JavaScript, so a broadcast to 50,000 sockets is 50,000
serialisations of identical bytes plus 50,000 trips through the framing code.

`broadcastPositions` has a milder version of the same problem — the payloads
differ per device, so there is nothing to share, but each one is still a separate
frame for twelve floats.

**Fix, three layers.**

*Serialise once.* For any message that goes to more than one socket, stringify
once and reuse the buffer.

*Coalesce per connection.* Give each connection a small outbox and flush every
~50 ms as a single frame containing an array. A device's `SET_POINT`, its
neighbour list and anything else pending travel together. This is `AdminDigest`'s
argument applied to devices: a phone is not following an event log, and two
updates in one window have one useful outcome between them.

*Consider the platform.* `@fastify/websocket` sits on `ws`, which does its
framing in JavaScript. uWebSockets.js does it in C++ and has topic-based pub/sub
built in — which is the exact shape of the spatial cells in section 12. The
difference is roughly 50–80k small messages a second per core against 300–500k.
Worth measuring before adopting, and probably worth adopting if 50,000 is the
target.

Going binary on the hot frames belongs in the same conversation. A `SET_POINT` is
twelve floats — 48 bytes, or 24 as int16 centimetres — against roughly 250 bytes
of JSON, and it removes the parse on both ends.

## 9. Nothing bounds a slow socket

*`sendMessage` again*

When a connection stops draining, `socket.send` does not fail and does not block
— it accumulates the frames in the server's memory, with no ceiling. One phone on
a bad connection, or one simulated device
whose shard is starved, quietly accumulates megabytes. At 50,000 connections a
handful of them behaving that way is gigabytes of heap that no one asked for, and
the failure looks like a memory leak rather than like a slow client.

**Fix.** Check `bufferedAmount` before sending and drop when it exceeds a
threshold. Dropping is safe for exactly the reason `bus.ts` already gives about
the positions stream: updates are last-write-wins, and a client that missed one
gets the next. Pair it with a counter, so a run reports how much it discarded
instead of hiding it — silent dropping and silent buffering are equally
misleading, in opposite directions.

## 10. The panel is handed the whole field

*`AdminDigest.take`, `apps/backend/src/events/admin-digest.ts`*

The digest is the right idea — it bounds the panel's traffic by the number of
devices rather than by how talkative they are, and its own comment makes the
case. But at 50,000 devices the bound is still 50,000 locations and 50,000
positions per second, plus every edge that changed. That is roughly 25 MB/s of
JSON for one browser tab, which is a serialisation cost on the API and a parsing
cost the panel will not keep up with.

**Fix.** Two things the digest cannot do from where it sits. Send the field in a
binary layout rather than JSON — positions are floats and device ids can be
interned to integers for the duration of an event. And cut by viewport: the panel
draws a region at a zoom level, and a device it will not render is a device it
does not need. Both are the same observation as section 12 pointed at the admin
instead of at the crowd: send what the receiver can use.

## 11. Saturation disguises itself as a reconnect storm

*`startHeartbeat`, `apps/backend/src/http/ws/protocol.ts:14`*

The server pings every 30 seconds and terminates connections that have not
answered by the next tick. That is correct behaviour for dead sockets and a trap
for load tests: when the event loop falls behind, pongs stop being processed in
time, the server terminates thousands of live connections, and every one of them
reconnects — which fires `subscribe`, which broadcasts (section 2), which makes
the event loop fall further behind.

The measurement that comes out of that run is of the reconnect storm, not of the
thing being tested, and the failure is fully self-inflicted. Worse, it is
bistable: the same load either sits quietly or collapses completely, depending on
where it started.

**Fix.** Instrument before tuning. `perf_hooks.monitorEventLoopDelay` reports lag
directly, and a run should record it next to the throughput numbers — if p99 lag
is above a few tens of milliseconds, nothing else in the report means anything.
Widen the heartbeat's tolerance to two or three missed pings so transient lag
does not cost connections, and profile with `--cpu-prof` rather than reasoning
about where the time goes. Every number in this document is an estimate until a
profile agrees with it.

## 12. The shape of the fix: assign neighbours, don't announce arrivals

Sections 1 and 2 are the same problem, and it is worth stating the fix on its
own because it is the one that changes the contract.

A device needs to know which peers it can range against. Today the server answers
that by telling it about everyone and letting it work out the rest — the roster
on join, `USER_JOINED` thereafter. That answer is O(n) per join and O(n) per
lifecycle event, and almost all of it is discarded: at a standing-crowd density
of about three people per square metre, a six-metre radio reaches roughly 340
peers out of the 50,000 the device was told about.

The server already has what it needs to do better. It knows every device's
reported location, and `projectLocation` in contracts turns that into local
metres against the event's origin. A uniform grid over those coordinates —
`Map<cellKey, Set<deviceId>>`, updated in O(1) when a device changes cell — makes
"who is near this device" a lookup over nine cells instead of a scan.

Filtering the broadcast through that grid would already help enormously. But the
better move is to turn the message around:

> The server does not announce who arrived. It tells each device **which peers to
> measure**.

That reframing is what collapses the cost, because the size of the answer stops
depending on the crowd. Even after cell filtering, nine cells at six metres a
side hold around 970 candidates — still far more than a device will ever use,
since the simulator ranges against eight per sweep. So the server picks: a short
list, sixteen or so, spread out in angle around the device.

Picking is not a compromise, it is an improvement. The worker does not want a
dense graph, it wants a **rigid** one, and rigidity in two dimensions needs a
degree of about four to six with well-distributed directions. Sixteen peers
chosen for angular spread constrain a position better than three hundred and
forty clustered ones, and they cost the worker far less to solve. The server is
already the only party with a global view; deciding the measurement topology is a
job it is uniquely placed to do and currently declines.

What it costs:

- **Join** returns sixteen peers — several hundred bytes instead of 8 MB.
- **Steady state** becomes one short list per device whenever its neighbourhood
  materially changes, or every ten seconds or so as a floor: about 5,000
  messages a second across the whole crowd, against 1.25 million. The rate now
  depends on the refresh interval, which is a dial, rather than on the churn
  rate, which is not.
- **Departure** stops being a broadcast. A device that vanishes disappears from
  the next neighbour list of the sixteen or so devices that cared, and everyone
  else was never told it existed.

Two caveats worth writing down.

*The grid is a candidate filter, not a source of truth.* GPS is accurate to
metres and the radio range is six, so a cell assignment can be wrong. That is
fine — a wrong candidate produces a ranging attempt that fails and gets retracted
with a `null` distance, which the protocol already handles. Sizing cells at or
above the GPS error keeps the false-negative rate low, which is the direction
that actually matters: a peer never suggested is a peer never measured.

*The assignment improves as the worker converges.* Early on the server only has
GPS. Once the worker starts publishing positions, it has something far better,
and neighbour selection can switch to the solved coordinates it is already
receiving in `broadcastPositions`. The system bootstraps from the measurement it
distrusts and moves to the estimate it computed, which is the same progression the
panel already draws when it swaps a device's outline for a pixel.

## Running 50,000 on one machine

The protocol work above is necessary and not sufficient; the operating system has
opinions too.

**File descriptors.** 50,000 sockets in the API and 50,000 in the simulator is
100,000 descriptors on one machine. macOS defaults to 256 per process. Raise it
with `ulimit -n 1000000` in both shells, and lift `kern.maxfiles` and
`kern.maxfilesperproc` via `sysctl` to match.

**Ephemeral ports.** Every loopback connection to a single `127.0.0.1:3333`
consumes a source port, and the default ephemeral range on macOS is about 16,000
wide. 50,000 connections cannot fit. Three ways out, in increasing order of
cleanliness: widen `net.inet.ip.portrange.first`; add loopback aliases
(`ifconfig lo0 alias 127.0.0.2`, …) so each destination address gets its own port
space; or drop TCP entirely and listen on a **unix domain socket** — Fastify
takes a `path` in `listen`, and `ws` speaks `ws+unix://`. That removes the port
problem, the loopback stack and a copy per message, and it is the option that
makes the local run least like an accident of tuning.

**Memory.** A `ws` connection costs roughly 20–40 KB once buffers are counted, on
both sides: 4–6 GB before anything else. Confirm `perMessageDeflate` is off (it
is the server-side default, but the allocation it implies is large enough to be
worth asserting rather than assuming), set `skipUTF8Validation`, and cap
`maxPayload` to something a real frame cannot exceed.

**Cores.** The API's event loop is one thread. After sections 6 and 7, inbound is
around 75,000 frames a second, which fits in a core with room to work; before
them it is 250,000, which does not fit in three. The simulator is already sharded
across threads and does considerably more work per device than the API does —
GNSS sampling, sway, ranging — so on a machine with both, expect the simulator to
be the first thing that saturates. That is worth knowing in advance, because the
instinct when a run stalls is to blame the server.

**A shortcut worth taking first.** Client count and message rate are separate
axes, and only one of them is hard to arrange. Ten thousand clients at five times
the rate produce the same 250,000 messages a second and exercise nearly
everything in this document — the store, the stream, the fan-out cost per
message, the event loop. What they do not exercise is memory per socket and the
O(n²) terms, which are precisely the things that want measuring at full size.
Running the cheap experiment first means the expensive one is spent confirming a
result rather than discovering one.

## Order of work

Sequenced so that each step is independently measurable, and the ones that touch
the contract come after the ones that do not.

1. **`removeNode` in O(degree)** (§3). Largest single win, contained entirely
   within `GraphStore`, no contract change.
2. **Trim the store writes** (§4, cheap) and **turn on auto-pipelining** (§5).
   A handful of lines each.
3. **`DISTANCES` batching and delta reporting** (§7). Touches contracts, backend
   and simulator, and cuts inbound by roughly an order of magnitude.
4. **Batch the ingest stream** (§5) and **move the store off the per-message
   path** (§4, better/honest).
5. **Spatial grid and neighbour assignment** (§12). The structural change, and
   the one that makes horizontal scaling possible at all.
6. **Outbox coalescing and backpressure** (§8, §9).
7. **Measure** (§11). Only then decide about uWebSockets.js, binary frames and
   the panel's field format — those are answers to profiles, not to arguments.

## What this means for scaling out

Horizontal scaling is a later problem, but section 12 is what decides whether it
is a solvable one. A global broadcast cannot be sharded: every node would have to
receive every event from every device, which is the same O(n²) with more network
in the middle. Neighbourhoods can be, because they are local by construction —
connections stay sticky to the node that accepted them, cells become pub/sub
topics, and a node subscribes only to the cells where it currently holds devices.
Cross-node traffic then scales with the boundary between partitions rather than
with the size of the crowd.

Which leaves one question worth answering before designing any of it: **does a
single event fit in one process?** If it does, sharding by `eventId` is nearly
free and everything above is unnecessary. Getting a 50,000-device run to hold on
one machine is how that question gets answered — which is the argument for doing
it, quite apart from the fact that it would be a good thing to have done.
