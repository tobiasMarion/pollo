/**
 * How wrong a measured distance is, as a function of how long it is.
 *
 * `sigma(d) = floor + relative·d` — a fixed floor plus a share of the distance.
 * The *form* is a premise: every short-range ranging technique, whatever the
 * underlying trick, gets a roughly fixed fraction of a metre wrong per metre,
 * on top of a floor that does not go away when two devices touch.
 *
 * The *numbers* are not a premise. They are measured, below.
 */
export interface Scale {
  floor: number
  relative: number
}

/**
 * Where the estimate starts before it has seen anything.
 *
 * Deliberately not tuned to any particular radio: it is replaced within a few
 * ticks by what the residuals actually say, and its only job is to make the
 * first sweeps sane. Getting it wrong costs a second of convergence, not
 * accuracy.
 */
export const INITIAL_SCALE: Scale = { floor: 0.1, relative: 0.05 }

/** A sigma below this would divide by nearly nothing. Centimetres. */
const MIN_SIGMA = 0.01

/** Half a residual's worth of one-sided normal: median|r| ≈ 0.6745·sigma. */
const MEDIAN_TO_SIGMA = 1 / 0.674_489_75

export function sigmaAt(scale: Scale, distance: number) {
  return Math.max(MIN_SIGMA, scale.floor + scale.relative * distance)
}

/**
 * Fits the two parameters from the residuals the solve is already producing.
 *
 * **Medians, not means.** A residual is `‖x_i − x_j‖ − d_ij`, and in a real
 * graph some of those are not noise at all — a reflection, a body in the way, a
 * pair that should never have been measured. A mean is moved by one of those; a
 * median is not.
 *
 * **Two halves, not a regression.** Split the samples at their median distance,
 * take a robust sigma for each half, and draw the line through the two points.
 * A least-squares line through the residuals would be fitting a scale estimator
 * with the very method whose weights it is supposed to set, and would inherit
 * exactly the sensitivity to outliers this is trying to avoid.
 *
 * Early on the residuals are mostly *reconstruction* error rather than
 * measurement error, so sigma comes out large and every edge is trusted a
 * little less. That is the correct thing to believe at that moment, and it
 * unwinds on its own as the solve settles.
 */
export function estimateScale(samples: readonly Sample[]): Scale | null {
  // Two halves need enough in each half for a median to mean anything.
  if (samples.length < 16) return null

  const sorted = [...samples].sort((a, b) => a.distance - b.distance)
  const middle = sorted.length >> 1

  const near = summarize(sorted.slice(0, middle))
  const far = summarize(sorted.slice(middle))

  if (!near || !far) return null

  const span = far.distance - near.distance

  // Every sample at the same distance says nothing about how sigma grows with
  // distance. Take the level and assume the slope is flat rather than dividing
  // by a span of zero.
  if (span < 1e-6) return { floor: Math.max(MIN_SIGMA, near.sigma), relative: 0 }

  const relative = (far.sigma - near.sigma) / span
  const floor = near.sigma - relative * near.distance

  // A sigma that shrinks with distance, or a negative floor, is a fit to noise
  // in the fit. Clamping is honest here: the form is the premise, and a
  // violation of it means this batch of samples had nothing to say.
  return {
    floor: Math.max(MIN_SIGMA, floor),
    relative: Math.max(0, relative),
  }
}

export interface Sample {
  distance: number
  residual: number
}

function summarize(half: readonly Sample[]) {
  if (half.length === 0) return null

  const magnitudes = half.map(sample => Math.abs(sample.residual)).sort((a, b) => a - b)

  return {
    distance: median(half.map(sample => sample.distance)),
    sigma: median(magnitudes) * MEDIAN_TO_SIGMA,
  }
}

/** Assumes sorted input for the magnitudes; sorts otherwise. */
function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = sorted.length >> 1

  if (sorted.length % 2 === 1) return sorted[middle] ?? 0

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/**
 * Eases one estimate towards the next.
 *
 * A scale recomputed from scratch every tick jitters, and the weights it sets
 * jitter with it — which shows up as the whole crowd breathing. The estimate is
 * about a sensor, and a sensor does not change several times a second.
 */
export function blendScale(current: Scale, next: Scale, weight: number): Scale {
  return {
    floor: current.floor + (next.floor - current.floor) * weight,
    relative: current.relative + (next.relative - current.relative) * weight,
  }
}
