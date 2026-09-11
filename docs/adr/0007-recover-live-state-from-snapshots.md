# ADR 0007: Recover live state from snapshots

## Status

Accepted

## Context

Redis Streams carry the changes between the API and the position worker. They
are intentionally bounded: history is useful for crossing a short interruption,
but replaying the lifetime of an event is an expensive and ambiguous way to ask
what is true now.

The API already keeps the current distance graph for panel snapshots. A worker
that restarted used to skip the retained ingest stream and begin with an empty
graph, so devices that remained connected stopped receiving positions until
they happened to report enough changes to rebuild it.

Event lifecycle had the inverse problem. Replaying an unbounded control stream
could reconstruct open events, but made a tiny piece of current state depend on
permanent history.

## Decision

Streams describe change; Redis hashes describe current recoverable state.

- `events:open` mirrors the origin of every open event.
- `graph:<event>:locations`, outgoing edges and their reverse indexes are the
  authoritative graph snapshot already maintained by the API.
- ingest and control streams are bounded approximate logs.

On startup the worker records stream cursors first, reads the open-event and
graph snapshots second, then consumes everything after those cursors. A write
racing recovery is consequently visible in the snapshot or waiting in the
stream. Applying a graph mutation twice is harmless because the operations set
or remove current values rather than append facts.

The API writes graph state before publishing its matching ingest window. A
failed window stays at the head of the publisher and is retried before later
windows, preserving order. Event lifecycle updates its state hash and control
stream in one Redis transaction.

After an API restart, the old process's sockets no longer exist. It clears their
orphaned graph before announcing each still-open event again; a running worker
treats that announcement as a new runtime generation and replaces its in-memory
event from the now-empty snapshot.

## Consequences

A worker restart resumes an existing crowd without replaying event history.
Streams can be trimmed without changing correctness, and their size now reflects
the interruption window we want to tolerate rather than the age of the system.

The state write and ingest publish are ordered and retried, but are not a
transactional outbox: a hard API crash in the narrow interval between them can
delay that delta until another snapshot recovery. If Pollo moves from a
single-process pet project to a service with stronger delivery guarantees, the
two writes should become one Redis-side operation or an explicit outbox.

This is recovery, not multi-API coordination. The current deployment owns live
sockets in one API process; horizontal scaling still requires explicit ownership
or leases for graph nodes.
