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
- [Reflections](#reflections) — why multipath is a state, not a spike
- [What the crowd shares](#what-the-crowd-shares) — the common-mode split
- [Ranging](#ranging) — the distance graph, which is what the geometry lives on

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

## Reflections

The standard GPS error budget puts multipath at about **±1 m** — and then notes
that it is "more severe in urban canyons". A stadium bowl is an urban canyon
with better catering. That nominal metre is the open-sky case and says nothing
about a seat with a stand rising behind it, which is why reflections get their
own model here instead of a larger σ.

### Why a state and not a spike

| | model | biased? | persists? | directional? | verdict |
|---|---|---|---|---|---|
| Student's t | heavy tail on the error | no | no | no | rejected |
| Gaussian mixture | occasional wide draw | no | no | no | rejected |
| **Two-state Markov chain** | clean ⇄ reflected | yes | yes | yes | chosen |

The two rejected models are cheaper and wrong in the same way: they produce
spikes that **vanish on the next sample**. A three-point median removes those
entirely. A worker tuned against them has been tuned against a problem that does
not exist, and would meet the real one — which a median does not touch —
untrained.

What makes multipath hard is that it *persists*. The reflection geometry holds
for seconds, so the error looks like a plausible new position rather than an
obvious outlier. The device is not noisy; it is confidently somewhere else.

It is also **directional**, and the direction is not random. See
[`crowd/README.md`](../crowd/README.md#where-a-reflected-fix-goes) for why it
points inward over the pitch: this module supplies the dwell times and the
magnitude, the zone supplies the heading.

Each device's bias direction is the zone's, perturbed by 35% of a random unit
vector. If every device in a sector shared one exact vector, an estimator could
cancel the whole effect by averaging neighbours — which is not a defence that
works in the field.

### The reported accuracy lies, deliberately

`horizontalAccuracy` and `verticalAccuracy` are computed from the zone's clean
σ, **ignoring any reflection in progress**.

This is the single most important line in the module. A phone publishes the
*formal* uncertainty of its solution — a function of geometry and signal
strength. It has no term for a reflection it does not know happened. Reporting
the true error would hand the worker an oracle saying "discard me right now",
and a worker built on that oracle falls over the first time it meets hardware.

Each device also carries a fixed optimism factor in [0.7, 1.1], because
receivers do not all lie by the same amount about how well they know themselves.

## What the crowd shares

Two phones twenty metres apart are not making independent mistakes. They are
reading the same satellites through the same ionosphere with the same broadcast
ephemeris, and most of what is wrong with one is wrong with the other. Look at
the [UERE budget](../crowd/README.md#sources): ionosphere ±5 m, ephemeris
±2.5 m, satellite clock ±2 m — those are the three largest terms, and all three
are common to everyone in the venue.

Treating device errors as independent is therefore **the single most flattering
assumption a simulator can make**. Averaging neighbours would wipe the error
out, and the shape of the crowd would fall out of raw GPS far better than it
ever does in reality.

```
error(device) = w_c·OU_event + w_s·OU_sector + w_d·OU_device
```

`--common-mode` sets the correlated share, default 0.8, split 80/20 between
venue-wide and per-sector. The knob sweeps two genuinely different problems: at
0.8 the worker refines a decent shape, at 0 it has to build one.

**The weights are square roots**, because variance is what adds. Mixing by the
shares themselves would quietly shrink the total error — a bug that looks like
good results.

The vertical uses a slightly higher correlated share than the horizontal.
Height is the most common-mode quantity a constellation produces: the same
geometry lifts or drops the whole venue together.

### How the crowd agrees without talking

The shared field is a pure function of the seed, and it advances by **absolute
tick index** rather than by elapsed time. Every shard builds the same field and
replays any ticks it missed instead of taking one large step — a large step is
not the same random path.

That is what lets twenty thousand devices across eight threads see the same
common-mode error with no message ever exchanged about it. See
[`run/`](../run).

## Ranging

**This is the part the reconstruction actually lives on.** GPS supplies a
starting guess; the distance graph carries the geometry. A ranging model that is
too kind makes the whole exercise meaningless, so this is the last place to
reach for an additive Gaussian.

### Radio ranging is not a distance measurement

It is a *power* measurement inverted through a propagation model. Three
consequences an additive Gaussian throws away:

1. **The error is multiplicative.** Distance is recovered from received power
   through `d ∝ 10^(loss / 10γ)`, so a fixed dB error becomes a proportional
   distance error. A ±3 dB wobble is ±30% at any range, not ±3 m.
2. **Anything in the way reads as farther, never nearer.** Attenuation only ever
   subtracts power, and less power inverts to more distance. A body across the
   line of sight biases the link **long**; nothing biases it short.
3. **Whether a peer is heard at all decays with range.** That leaves a sparse,
   irregular, asymmetric graph — not the tidy k-nearest lattice a naive
   simulator hands over, and asymmetric because A hearing B does not mean B
   heard A on the same sweep.

Everything is computed in dB and converted once, because that is the domain
where the physics is linear.

### The model

```
loss_dB   = shadowing + blockage
distance  = d_true × 10^(loss_dB / (10 × γ))
```

- **γ = 2.6**, the path loss exponent. Free space is 2.0; published measurements
  put obstructed indoor environments at 2.4–3.0. A packed crowd is not an
  office, but it is much closer to one than to free space — every metre of path
  costs another body.
- **Shadowing** is zero-mean Gaussian in dB, i.e. log-normal in the linear
  domain, at σ = 6 dB. Measured values across building types span 3–14 dB.
  Because it is zero-mean *in dB*, it is unbiased in the log domain — which
  `ranging.test.ts` asserts directly.
- **Blockage** is one-sided: a gamma draw added only when a body is judged to be
  in the way, with the chance rising with distance through a mean free path.
  This is what makes a blocked link read as too far rather than merely noisy.
- **Detection** falls off as a Gaussian in `d/range`. Beyond `range` nothing is
  heard at all.

### Two limits, and they are not the same limit

`--range` bounds the **true** distance a radio can hear. `--max-edge` is the
longest distance a device is willing to **report**, defaulting to `--range`.

They have to be separate, and the reason is a direct consequence of point 1
above. `range` does nothing about the measurement, which is multiplicative and
biased long: with a six-metre radio, a large share of edges compute out above
six metres and the tail reaches absurd values. A device cannot know the true
distance — but it does know its own radio, and a computed distance far past what
that radio can physically reach is one a real proximity client discards rather
than reports.

**The surviving measurements are censored, not clamped.** An over-range
measurement is dropped, not squashed against the limit. Clamping would pile a
spike of mass exactly at the boundary, which is an artefact no receiver
produces and which an estimator would happily fit. The worker meets the same
censored distribution in the field.

## Parameters

| symbol | value | provenance |
|---|---|---|
| splitmix32 constants `0x9e3779b9`, `0x21f0aaad`, `0x735a2d97` | — | literature — the published splitmix32 mixing constants |
| Marsaglia–Tsang `d = shape − 1/3`, `c = 1/√(9d)`, squeeze `0.0331` | — | literature — the constants given with the method |
| horizontal τ | 15 s, 400 s | calibrated — two decades apart, approximating 1/f over the length of a show |
| vertical τ | 45 s, 1200 s | calibrated — slower than horizontal, on the reasoning above |
| layer σ | `1/√2` each | derived — independent layers add in variance, so two equal layers give unit total |
| `CLEAN_DWELL_AT_FULL_EXPOSURE` | 40 s | calibrated — divided by susceptibility, so a sheltered seat waits proportionally longer |
| `REFLECTED_DWELL` | 8 s mean | calibrated — long enough that a three-point median cannot remove it, which is the point |
| `MAGNITUDE_SHAPE` | 2 | calibrated — a gamma shape of 2 gives a hump with a tail rather than a bell or an exponential |
| magnitude scale | 7 + 8·susceptibility m | calibrated — well above the ±1 m nominal multipath term, which is the open-sky case |
| `SIGMA_INFLATION` | 2.5 | calibrated — the clean error also worsens while the geometry is bad, not only the bias |
| optimism | [0.7, 1.1] | calibrated — receivers differ in how well they estimate their own uncertainty |
| `--common-mode` default | 0.8 | calibrated — the three largest UERE terms are common-mode, so most of the error should be |
| `SECTOR_SHARE_OF_SHARED` | 0.2 | calibrated — most of the correlated error is venue-wide, a fifth of it sector-scale |
| vertical common-mode | `min(0.95, share × 1.15)` | calibrated — height is more common-mode than the horizontal |
| `FIELD_TICK_SECONDS` | 0.25 | calibrated — fine against the fastest τ (15 s), coarse enough to be cheap to replay |
| `PATH_LOSS_EXPONENT` γ | 2.6 | literature-anchored — free space is 2.0, published soft-partition office measurements are 2.4–2.6, hard-partition 3.0. A crowd is not an office; 2.6 is the obstructed end of that band. |
| `SHADOWING_SIGMA_DB` | 6 dB | literature-anchored — measured log-normal shadowing spans 3–14.1 dB across building types; 6 is mid-low in that range |
| `BODY_MEAN_FREE_PATH` | 8 m | calibrated — how far a line of sight travels before a body is likely to cross it |
| `BLOCKAGE_LOSS_SHAPE` / `_SCALE` | 3 / 3.5 dB | calibrated — a one-sided gamma; 2.4 GHz is absorbed well by water, so a body is a real loss and never a gain |
| `PEAK_DETECTION` | 0.98 | calibrated — even at zero range a packet is occasionally missed |
| `DETECTION_DECAY` | 2.2 | calibrated — sets how fast the graph thins with range |
| bias spread | 0.35 of a unit vector | calibrated — enough that averaging neighbours cannot cancel the sector's direction |

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
- [Log-distance path loss model](https://en.wikipedia.org/wiki/Log-distance_path_loss_model)
  — the `L = L₀ + 10γ·log₁₀(d/d₀) + Xg` form this inverts, the empirical table of
  path loss exponents (free space 2.0, soft-partition office 2.4–2.6,
  hard-partition office 3.0), and the Gaussian-in-dB / log-normal-in-linear
  shadowing term with measured σ spanning 3–14.1 dB
- [Error analysis for the Global Positioning System](https://en.wikipedia.org/wiki/Error_analysis_for_the_Global_Positioning_System)
  — the UERE budget whose three largest terms (ionosphere, ephemeris, satellite
  clock) are what makes the error common-mode, and the ±1 m nominal multipath
  entry with its "more severe in urban canyons" caveat
