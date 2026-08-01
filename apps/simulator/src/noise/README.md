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

## Parameters

| symbol | value | provenance |
|---|---|---|
| splitmix32 constants `0x9e3779b9`, `0x21f0aaad`, `0x735a2d97` | — | literature — the published splitmix32 mixing constants |
| Marsaglia–Tsang `d = shape − 1/3`, `c = 1/√(9d)`, squeeze `0.0331` | — | literature — the constants given with the method |

## Sources

- [Xorshift § xoshiro and xoroshiro](https://en.wikipedia.org/wiki/Xorshift) —
  the generator family, its state, and the reason a poor seeding recovers slowly
- [Box–Muller transform](https://en.wikipedia.org/wiki/Box%E2%80%93Muller_transform)
  — the pair-of-samples property this relies on
- [Gamma distribution § Random variate generation](https://en.wikipedia.org/wiki/Gamma_distribution)
  — the Marsaglia–Tsang method and its constants
