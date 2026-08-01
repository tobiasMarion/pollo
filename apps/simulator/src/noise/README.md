# noise — what the sensors get wrong

A device reports a position it does not have and a distance it did not measure.
This module decides how wrong both are.

Everything here is a deliberate choice against a cheaper model that would have
been easier to write and useless to solve. Each section says what was rejected
and why, and every constant is in a table at the end with its provenance:
**literature** where a source supports it, **calibrated** where it was tuned to
produce a stated outcome.

## Contents

- [Randomness](#randomness) — the primitive everything else samples through
- [Drift](#drift) — why the error has memory

## Randomness

`random.ts` is not a noise model. It is the source every other file in the
repository draws from, and it is here because noise is what it exists for.

`Math.random` cannot be seeded. A run that cannot be replayed turns a defect
into an anecdote, so the CLI prints a seed and every draw in the process
descends from it.

### The generator

**xoshiro128\*\***, seeded through **splitmix32**. Both are from Blackman and
Vigna's family of small-state generators.

The seeding matters more than it looks. xoshiro's state is four 32-bit words and
its recovery from a state of mostly zeros is slow — a run seeded with `1` would
spend its first thousand draws visibly correlated. splitmix32 spreads a single
integer across all four words first, which is the use it was designed for.

Per-device streams come from `deriveSeed(seed, index)`, mixing the run seed with
the device's **global** index rather than the order it was handed out. A device
therefore behaves identically no matter which shard picked it up or how many
threads the run used — which is what makes `--threads` a performance knob rather
than a variable of the experiment.

### The distributions

| draw | method | why not something simpler |
|---|---|---|
| `gaussian()` | Box–Muller | The transform produces two independent samples per pair of uniforms. Keeping the second halves the cost, and a full crowd needs millions of draws a minute. |
| `exponential(mean)` | inverse CDF | Exact and one `log`. Dwell times and inter-arrival gaps are memoryless, which is the whole reason the multipath chain can be a Markov chain. |
| `gamma(shape, scale)` | Marsaglia–Tsang | Multipath excursions are a positive quantity with a tail. A normal gives negative magnitudes, a uniform gives no tail. Marsaglia–Tsang is rejection-based with an acceptance rate near 1 for shape ≥ 1, and the shape < 1 case is boosted and scaled back. |
| `unitVector()` | inverse-transform on `z` | Sampling a direction by drawing three normals and normalising works but costs three Gaussians. Drawing `z` uniformly and an azimuth uniformly is exactly uniform on the sphere — the cylindrical projection of a sphere preserves area — and costs two uniforms. |

`1 - float()` appears twice, in `gaussian` and `exponential`. `float()` can
return exactly zero, and `log(0)` is `-Infinity`; the flip moves the excluded
endpoint to where it does no harm.

## Drift

A GNSS error is not redrawn every second. A reading ten metres off now will be
near ten metres off a second from now, and the direction it is off in holds for
minutes. Any model without that memory is not modelling GNSS.

### Choosing the process

| | model | verdict |
|---|---|---|
| White noise | error resamples every tick | rejected — no receiver behaves this way, and averaging a few samples would remove it entirely |
| Random walk (Wiener) | has inertia, unbounded variance | rejected — variance grows without bound, so half an hour puts a phone hundreds of metres outside the stadium |
| **Ornstein–Uhlenbeck** | inertia *with* mean reversion | chosen |

OU is the random walk with a restoring pull toward the mean: if the current
value is above the mean the drift is negative, and below it positive. That is
what gives it the one property the walk lacks — **bounded variance** — while
keeping the one white noise lacks.

Its stationary standard deviation is what the `sigma` field means, and the
process is started by drawing from that stationary distribution rather than from
zero. Starting at zero would hand every device a suspiciously accurate first
minute.

### The exact discretisation

The obvious update is Euler, and it is the one most references give:

```
x ← x − (dt/τ)·x + σ·√(2·dt/τ)·N(0,1)        # Euler — not used here
```

This code uses the **exact** update instead:

```
φ = exp(−dt/τ)
x ← x·φ + σ·√(1 − φ²)·N(0,1)
```

The difference matters for one specific reason: the exact form is correct **for
any step size**, so the stationary σ that comes out is the σ that was asked for
no matter how often it is stepped. Euler is only accurate for `dt ≪ τ` and
injects an amount of noise that depends on the step. A load test whose whole
purpose is to vary `--report-hz` must not change how much noise it injects when
you do — otherwise every comparison across rates is confounded.

`ou.test.ts` asserts the stationary σ and the autocorrelation against theory,
which is the check that this is the exact form and not the approximate one.

### Layering

Real GNSS bias has roughly a 1/f spectrum: a fast component that shifts within a
song and a slow one that holds a direction for the whole show. No single τ
produces both, so `LayeredOu` sums two — and because independent processes add
in **variance**, the layer sigmas are each `1/√2` to total unit variance.

The vertical layers are slower than the horizontal (45 s / 1200 s against 15 s /
400 s). An altitude bias comes from the satellite geometry above the venue,
which turns over on the timescale the constellation moves, not the timescale a
phone moves.

## Parameters

| symbol | value | provenance |
|---|---|---|
| splitmix32 constants `0x9e3779b9`, `0x21f0aaad`, `0x735a2d97` | — | literature — the published splitmix32 mixing constants |
| Marsaglia–Tsang `d = shape − 1/3`, `c = 1/√(9d)`, squeeze `0.0331` | — | literature — the constants given with the method |
| horizontal τ | 15 s, 400 s | calibrated — two decades apart, approximating 1/f over the length of a show |
| vertical τ | 45 s, 1200 s | calibrated — slower than horizontal, on the reasoning above |
| layer σ | `1/√2` each | derived — independent layers add in variance, so two equal layers give unit total |

## Sources

- [Xorshift § xoshiro and xoroshiro](https://en.wikipedia.org/wiki/Xorshift) —
  the generator family, its state, and the reason a poor seeding recovers slowly
- [Box–Muller transform](https://en.wikipedia.org/wiki/Box%E2%80%93Muller_transform)
  — the pair-of-samples property this relies on
- [Gamma distribution § Random variate generation](https://en.wikipedia.org/wiki/Gamma_distribution)
  — the Marsaglia–Tsang method and its constants
- [Ornstein–Uhlenbeck process](https://en.wikipedia.org/wiki/Ornstein%E2%80%93Uhlenbeck_process)
  — mean reversion ("if the current value of the process is less than the
  long-term mean, the drift will be positive"), the bounded variance that
  distinguishes it from the Wiener process, and the stationary variance
  σ²/(2θ). Note this article gives only the **Euler** finite-difference update,
  not the exact one used here.
- D. T. Gillespie, "Exact numerical simulation of the Ornstein-Uhlenbeck process
  and its integral", *Physical Review E* **54**(2), 1996, pp. 2084–2091
  ([APS](https://link.aps.org/pdf/10.1103/PhysRevE.54.2084),
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/9965289/)) — the update that is exact
  for any Δt, which is the property this module depends on
