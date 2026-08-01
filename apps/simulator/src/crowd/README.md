# crowd — building an audience

Where twenty thousand people are, and what the building does to each of them.

Nothing here is random in the interesting sense: the bowl is a pure function of
the seed, so every thread derives the same stadium independently and no seat is
ever sent across a thread boundary. What varies is who sits where.

## Contents

- [The bowl](#the-bowl) — the plan, the rake, and where the seats are
- [Filling it](#filling-it) — which seats are taken
- [What a seat can see of the sky](#what-a-seat-can-see-of-the-sky) — masks, DOP
- [Who can hear whom](#who-can-hear-whom) — the neighbour index

## The bowl

### The plan is a superellipse, not an ellipse

Rows follow `|x/a|ⁿ + |y/b|ⁿ = 1` with **n = 4**.

An ellipse (n = 2) is the parametrisation that falls out of a first attempt and
it produces a shape no venue has: the corners collapse onto the diagonal and the
straight runs along the touchlines disappear. Real bowls are rounded rectangles.
At n = 4 the straights survive, which matters because the straights are where
the crowd is densest and where the geometry a reconstruction has to recover is
least ambiguous.

`superellipsePoint` uses the signed-power form. A naive `x^(2/n)` root loses the
sign and the curve breaks where it crosses an axis.

### Seats are placed by arc length, not by angle

The superellipse is not parametrised by arc length. Stepping `t` evenly bunches
seats into the corners — visibly, and by a factor that grows with `n`. So each
row is polygonised once into 4,000 segments, the cumulative length is
accumulated, and seats are placed by walking that table at a constant
`seatPitch`.

### Stairways are cut out

A seamless carpet of seats would flatter a reconstruction: the gaps are part of
what makes the problem real. Aisles are cut every `aisleEvery` seats, and the
cut is **offset by row** so the gangways read as radial lanes rather than a
spiral.

Seat positions carry a ±5 cm jitter. Real people are not on a lattice, and a
perfect lattice gives an estimator a regularity to exploit that it will not find
in a stadium.

## Filling it

A crowd does not distribute itself evenly. The lower ring fills first, some
sectors stay half empty, and the upper ring holds more seats than the lower one
while being the last to fill — so its weight has to undo that head start before
the weighting means anything.

Seats are drawn with **Efraimidis–Spirakis (A-Res)**: key each seat by `u^(1/w)`
and take the largest keys. That is a weighted sample without replacement in one
pass, with no rejection loop to stall on a nearly-full stadium. Rejection
sampling would degrade exactly where the load test is most interesting.

> A numerically more stable variant keys by `−ln(u)/w` and takes the smallest.
> At these weights (0.14 to 1) and this population it makes no difference, but
> it is the form to reach for if weights ever span orders of magnitude.

## What a seat can see of the sky

*(zones.ts — arrives with the next commit)*

## Who can hear whom

*(grid.ts — arrives with the commit after)*

## Parameters

| symbol | value | provenance |
|---|---|---|
| `planExponent` | 4 | calibrated — the lowest exponent that keeps the touchline straights; n=2 collapses them |
| `pitchLength` × `pitchWidth` | 105 × 68 m | literature — the dimensions the Laws of the Game recommend for a competitive pitch |
| `seatPitch` | 0.5 m | calibrated — a seat width; sets the perimeter density |
| `aisleEvery` / `aisleWidth` | 40 / 3 seats | calibrated — produces gangways at a plausible spacing |
| `phoneHeight` | 1.4 m | calibrated — chest height on a standing crowd |
| `seatJitter` | ±0.05 m | calibrated — enough to defeat lattice regularity, small against every error modelled |
| tier rake (`rise`/`rowDepth`) | 0.45/0.8 lower, 0.52/0.8 upper | calibrated — a steeper upper ring, as built |
| `roofHeight` / `roofDepth` | 44 m / 26 m | calibrated — sets which seats lose sky to the canopy |
| `ANGULAR_SECTORS` × `ROW_BANDS` | 8 × 3 per tier (48 zones) | calibrated — see the note on resolution in [zones](#what-a-seat-can-see-of-the-sky) |

## Sources

- [Superellipse](https://en.wikipedia.org/wiki/Superellipse) — the Lamé curve,
  its exponent, and the signed-power parametrisation
- [Reservoir sampling § Algorithm A-Res](https://en.wikipedia.org/wiki/Reservoir_sampling)
  — Efraimidis–Spirakis weighted sampling without replacement, the `u^(1/w)`
  key, and the more stable `−ln(u)/w` variant
