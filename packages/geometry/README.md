# Geometry

The maths Pollo is made of. No wire, no IO, and no opinions about devices — every
function in here takes scalars, flat arrays and options, and could not tell you
what an event is.

```bash
npm test -w @pollo/geometry     # runs under the coverage gate
```

## What is in it

| module | what |
|---|---|
| `vector` | `Vector3` and arithmetic on it |
| `geodesy` | the equirectangular field frame, and ECEF |
| `stats` | the median, which is the one order statistic the reconstruction depends on |
| `random` | a seeded generator — a run that cannot be replayed turns a defect into an anecdote |
| `linalg` | 3×3 row-major algebra, including a cyclic Jacobi eigendecomposition |
| `kabsch` | the best rigid motion between two clouds, reflections refused |
| `mds/csr` | the graph, laid out for the sweep instead of for updating |
| `mds/sigma` | how wrong a measured distance is as a function of how long it is, fitted from residuals |
| `mds/weights` | one over variance, per edge and per anchor, and the robust loss |
| `mds/stress` | the objective, so that the claim below is a test rather than a comment |
| `mds/guttman` | one pass of the transform that minimises it |
| `mds/relaxation` | the running mean over windows, one counter per point |

## The line this package draws

**It holds functions. The applications hold the numbers.**

A function belongs here only if it does not know what a device, an event or a
measurement is. Every constant that is a *tuning choice* — the initial sigma,
`omega`, `alphaMin`, the Huber knee, a noise model's parameters — stays with
whoever is solving.

That is what keeps `apps/worker` and `apps/simulator` apart while both depend on
this: they come to share a random number generator and a matrix decomposition,
not a model of the world. A solver tuned against the generator it is scored by
has been tuned to the parts of that generator that are wrong as eagerly as to the
parts that are right.

Dependencies run one way — `geometry` ← `contracts` ← apps — and there are none
at runtime, not even Zod. `Vector3` and `Origin` are declared here and
re-exported by `@pollo/contracts`, because a coordinate is a mathematical object
before it is a message field.

## Tests

Every function is exercised by name: 100% of functions, lines and statements,
enforced in `npm test` and in CI. The branch floor is deliberately low and is not
a target — `noUncheckedIndexedAccess` turns every typed-array read into
`arr[i] ?? 0`, and the `??` side of those is unreachable by construction.

What is tested is not that a function returns a number, but the properties that
justify each choice: that the CSR layout matches a naive reference and files each
measurement under both endpoints; that the Guttman step **never lets the stress
rise** at `omega = 1`; that `alpha = 1/n` is exactly the arithmetic mean of n
windows; that the sigma estimator recovers the curve of a sensor it was never
told about and says nothing at all below sixteen samples; that Kabsch refuses a
mirror image and declines to invent a rotation for a cloud collapsed onto a line.

Layout is `folder/index.ts` beside `folder/test.ts`, so a directory never holds
two files per subject.
