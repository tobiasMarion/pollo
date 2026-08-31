# ADR 0006 — The position worker, in TypeScript

- **Status:** accepted
- **Date:** 2026-08-31

## Context

ADR 0001 put the worker in Rust and made it the one component the owner would
write by hand, line by line, because it is the core of the system. That boundary
held through phases one and two, while the worker was a placeholder that returned
each device's own GPS reading. It stopped holding the moment the reconstruction
had to be measured rather than described.

Two things were learned in the measuring.

**The language was not the bottleneck.** A tick solves one graph: a few hundred
devices, a few thousand measured distances, eight sweeps over flat typed arrays.
That work is arithmetic on `Float64Array`s with no allocation in the inner loop,
which is exactly what a JIT is good at. At the crowd sizes the system is built
for, a tick costs a fraction of its 33 ms budget, and the process spends most of
its life waiting on Redis. The cost that was actually being paid for Rust was a
second toolchain, a second image, a second set of contract types kept in step
with serde, and a rewrite-by-hand rule that made the numerical work move at the
speed of one person's evenings.

**Force-directed was the wrong shape.** The original plan was a spring model:
push overlapping devices apart, pull measured pairs together, integrate. Springs
have a step size, a stiffness and a time step, and any of the three set wrong
makes the crowd oscillate or crawl. Worse, a spring model has no objective — there
is no number it is making smaller, so there is nothing to assert about it and no
way to tell a converged answer from a stuck one.

## Decisions

- **The worker is TypeScript**, in `apps/worker`, alongside the API and the
  panel. One toolchain, one set of contract types, one test runner.
- **Metric multidimensional scaling by Guttman majorization**, not springs. The
  objective is written down —

      S(X) = Σ_i wa_i·‖x_i − g_i‖²  +  Σ_ij w_ij·(‖x_i − x_j‖ − d_ij)²

  a soft spring from each device to its own GPS reading, plus one per measured
  distance, each weighted by one over its variance. That is the Gaussian maximum
  likelihood estimate. The Guttman transform minimises a function that sits above
  it and touches it at the current answer, so the objective cannot rise — there is
  no step size, no stiffness, and no time step to get wrong. `stress()` exists so
  that claim is a test rather than a comment.
- **Two departures from the textbook form, both bought with measurement.** The
  sweep is written in place (Gauss–Seidel) so information crosses the graph within
  one pass, and over-relaxed by `omega` so each device is thrown past its own
  answer. Together, at eight sweeps on a crowd of a hundred and twenty scored
  against the truth it was generated from: 2.56 m of error became 1.90 m at
  identical cost. `omega = 1.5` is the value that beats 1.0 on a standing crowd
  *and* on a moving one, which beats being much better at one and worse at the
  other.
- **Soft GPS anchors that never fade.** Each device is pinned to its own reading
  at one over the variance it reported, per axis, because a fix good to five
  metres across the ground is routinely twelve metres out in height. Fading the
  anchors as a device accumulates evidence was the obvious next idea and it is
  wrong: the anchors are the only thing fixing the frame, and relaxing them lets
  the whole cloud drift and turn. Measured, on the same crowd, RMSE went from
  2.56 m to 2.93 m. The averaging that fading was reaching for is a running mean
  over windows instead, which does not touch the frame.
- **The sensor is estimated, not configured.** `sigma(d) = floor + relative·d` is
  a premise about the *form* of ranging error; the two numbers are fitted from the
  residuals the solve is already producing, using medians and two halves rather
  than a regression, because a least-squares fit to residuals inherits exactly the
  sensitivity to outliers the robust loss exists to avoid.
- **`packages/geometry` (`@pollo/geometry`)**, a second shared package holding
  everything purely mathematical: vectors, the geodetic projection, the seeded
  generator, the 3×3 algebra and Kabsch alignment, and the whole MDS core — CSR
  adjacency, the sigma model, the weights, the Guttman step, the stress and the
  running mean. It has no runtime dependencies, not even Zod.
- **The line the package draws: it holds functions; the applications hold the
  numbers.** A function belongs in `@pollo/geometry` only if it does not know what
  a device, an event or a measurement is. Every constant that is a tuning choice —
  the initial sigma, `omega`, `alphaMin`, the Huber knee, the simulator's noise
  parameters — stays with whoever is solving. That is what keeps the worker and the
  simulator apart: they come to share a random number generator and a matrix
  decomposition, not a noise model. `apps/simulator/src/noise/` and
  `apps/simulator/src/crowd/` do not move, and neither does the effect brightness
  maths in the contracts, which is wire semantics every client has to compute
  identically.
- **Dependency direction is one-way:** `geometry` ← `contracts` ← apps. `Vector3`
  and `Origin` are declared in the geometry and re-exported by the contracts, so
  a coordinate is a mathematical object first and a message field second, and
  nothing that only needed the shape had to change its import.
- **Nothing constructs its own collaborators except `src/composition/`.** The
  solver takes the sweep and the fit as functions, `LiveEvent` takes its graph,
  ledger and solver assembled, and the registry takes a factory. That is not
  ceremony: it is what lets the sweep budget and the per-window blend be tested
  against a sweep that does something known, rather than only observed through a
  hundred and twenty devices of real geometry.
- **A coverage gate on the package, and only on the package.** Every function in
  `@pollo/geometry` is exercised by name, enforced at 100% functions, lines and
  statements in `npm test` and in CI. The branch floor is deliberately low:
  `noUncheckedIndexedAccess` turns every typed-array read into `arr[i] ?? 0`, and
  the `??` side of those is unreachable by construction. Putting a threshold on
  the worker as a whole would charge coverage for Redis plumbing, which is what
  the integration tier exists to cover.
- **Tests sit next to what they test, in `folder/index.ts` beside `folder/test.ts`.**
  A directory never holds two files per subject, and an import names the subject
  rather than a file.

## Consequences

- **The boundary in ADR 0001 is superseded.** The worker is no longer Rust and no
  longer written by hand only; what survives of the rule is that the numerical
  core is walked through rather than accepted, and that every claim in it is a
  test.
- **The serde mirror in ADR 0005 is moot.** `wire.ts` is still the one place the
  boundary is written down, but both ends are now TypeScript reading the same
  package.
- The build has two packages to compile in order, geometry first: root `packages`
  script, the `just packages` recipe the `dev`, `web`, `worker`, `simulate` and
  `test` targets depend on, one CI step, and both Dockerfiles.
- The reconstruction beats raw GPS by roughly a factor of three on an ordinary
  crowd, and keeps beating it through a dense knot, people standing above other
  people, two groups nothing measures across, a heavy-tailed sensor, one
  measurement in twenty being nonsense, a sensor that reads long, a crowd that is
  wrong together, and a sensor ten times noisier than expected. Each of those is
  one assertion in `apps/worker/src/solve/solver/test.ts`.
- What is deliberately still missing: the estimate is a filter, not an estimator
  with a covariance. It has no model of velocity and cannot predict. The proper
  answer is a Kalman filter, and this is not one.
