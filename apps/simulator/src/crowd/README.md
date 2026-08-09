# crowd — build an audience

Pollo runs wherever a crowd has phones: a club, a stand, a theatre. The shape of
that crowd is the input to everything downstream — how many neighbours a device
can hear, whether the graph is a surface or a chain, whether height carries any
information at all — so it is a choice the run makes explicitly, with `--venue`.

Every venue is a function from a capacity to a list of seats. It sizes itself to
the crowd, so `--clients` is the only other number involved, and it lays out a
few more seats than were asked for: people move during an event, and somebody who
moves needs an empty seat to move into.

Nobody stands exactly on the plan. The jitter in [`seat.ts`](seat.ts) is not
decoration — a perfectly regular lattice is a constraint no real crowd hands the
worker, and a reconstruction tuned against a lattice has been tuned against a
lattice.

## `square` — the control

```
  plan                              section
  # # # # # # # # # #
  # # # # # # # # # #               # # # # # # # # # #    1.4 m
  # # # # # # # # # #             ──────────────────────
  # # # # # # # # # #
```

A flat grid on 0.55 m centres, centred on the event origin. No relief, no
structure, one level. Everything the other two venues do to the error can be
read against this one, and its height axis is constant — which is exactly what
makes it useful when something downstream quietly stops using z.

Open sky: **σ 4 m horizontal, 8 m vertical**, the best a phone ever manages.

## `stands` — the raked block

```
  plan                              section
  ┌─────────────────────┐                              # #      ← last row
  │                     │                           # #
  │        pitch        │                        # #
  │      105 × 68 m     │                     # #
  └─────────────────────┘                  # #
     # # # # # # # #                     # #             rake: back 0.8 m,
     # # # # # # # #                  # #                      up 0.45 m
     # # # # # # # #             ─────────────────────
     # # # # # # # #                  ↑ first row, 8 m off the touchline
```

Rows wrapped around a rectangle, each one a step further out and a step higher.
The crowd fills a **block** behind the near touchline rather than a bracelet of
one row around the whole ground: spread five hundred people around a touchline
and each of them can hear exactly two neighbours, which leaves the worker a chain
to reconstruct rather than a surface. Once a block would be wider than the ground
is long, it wraps and the rows keep climbing.

A rectangle rather than the rounded bowl a stadium really is. The rounding costs
an arc-length integral per row and changes nothing the crowd can tell apart:
what reaches the worker is distances between neighbours, and those are set by the
row spacing either way.

Half the sky is stand: **σ 6 m horizontal, 12 m vertical**.

## `theater` — the hard one

```
  plan                                  section
        \    #########    /                          ####    ← balcony 2, +11 m
         \  ###########  /                      ####          ← balcony 1, +6 m
          \ ########### /
           \##### #####/  ← gangway            ############   ← floor, gently raked
            \### # ###/                  ─────────────────────
             \##   ##/                    stage
              \#####/
               \###/
                \#/  stage
```

Rows on concentric arcs facing the stage, spaced along each arc rather than by a
fixed angle — a fixed angle would fan the back rows out and pack the front ones
shoulder to shoulder. A gangway runs down the middle, as in a real house, and two
balconies sit above the back of the floor.

The balconies **overhang**, and that is the reason this venue exists. Two devices
metres apart on the plan can be six metres apart in height, so a reconstruction
that quietly works in two dimensions fails here instead of passing by luck. It is
also the only venue indoors, where a fix is mostly reflection and guesswork:
**σ 15 m horizontal, 25 m vertical**.

## The rest of the module

[`occupancy.ts`](occupancy.ts) decides who sits where — a partial Fisher–Yates,
so filling a hundred people into a full house costs a hundred swaps rather than a
shuffle of the whole plan.

[`grid.ts`](grid.ts) answers who is close enough to hear whom. A uniform grid of
cells one radio range wide: a device can only hear something in its own cell or
the eight around it, so a sweep costs the crowd's *density* rather than its size.
Comparing everyone to everyone is twenty thousand squared, twice a second.
