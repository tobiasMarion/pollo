import { type Sample, sigmaAt } from '../sigma/index.js'
import type { MdsState } from '../stress/index.js'
import { edgeWeight, robustFactor } from '../weights/index.js'

/** Below this two points are the same point and the direction between them is nothing. */
const COINCIDENT_M = 1e-9

export interface GuttmanOptions {
  /** Where the robust loss bends, in sigmas. `Infinity` makes it plain least squares. */
  huberKnee: number
  /**
   * Over-relaxation. `1` is the plain majorization, whose descent is guaranteed;
   * above that each point is thrown past its own answer, which covers more
   * ground per pass and guarantees nothing. See the note on the sweep itself.
   */
  omega: number
  /** Every nth edge contributes a residual to the scale estimate. */
  samplingStride: number
}

export interface GuttmanResult {
  /** The furthest any point moved. What a caller's early break reads. */
  maxDisplacement: number
  /** Residuals for the scale estimator, sampled rather than collected whole. */
  samples: Sample[]
}

/**
 * One pass of the Guttman transform: the least-squares step, in closed form.
 *
 * The objective is
 *
 *     S(X) = Σ_i wa_i·‖x_i − g_i‖²  +  Σ_ij w_ij·(‖x_i − x_j‖ − d_ij)²
 *
 * — a soft spring to each point's own independent reading, plus one spring per
 * measured distance whose rest length is that measurement. Weighted by one over
 * variance, that is the Gaussian maximum likelihood estimate.
 *
 * The second term is not quadratic in `x`, because a norm is not. Majorization
 * replaces it with something that is: for each neighbour, the point at exactly
 * `d_ij` from `x_j` **in the direction `x_i` currently lies**. That target moves
 * as the answer moves, but for the duration of one update it is a fixed point,
 * and the sum of weighted squared distances to a set of fixed points is
 * minimised by their weighted average. So:
 *
 *     x_i  ←  ( wa_i·g_i + Σ_j w_ij·(x_j + d_ij·u_ij) ) / ( wa_i + Σ_j w_ij )
 *
 * with `u_ij` the unit vector from `x_j` towards `x_i`. There is no step size,
 * no stiffness and no time step: each update exactly minimises a function that
 * sits above the real objective and touches it at the current answer, so the
 * real objective cannot go up. That is the reason to prefer this to springs,
 * which have all three of those knobs and can overshoot with any of them wrong.
 *
 * **Written in place, and deliberately over-relaxed.** Two departures from the
 * textbook form, both bought with measurement rather than taste — a crowd of a
 * hundred and twenty, scored against the truth it was generated from:
 *
 * - *In place* (Gauss–Seidel) rather than against a copy (Jacobi): a point sees
 *   the neighbours already updated in this pass, so information crosses the graph
 *   within one sweep instead of one hop per sweep. The cost is that the answer
 *   now depends on the order points are visited in. That order is the caller's
 *   `slots`, which is fixed and reproducible, so the solve stays deterministic —
 *   but it is no longer free of the question.
 * - *Over-relaxed*: each point is moved `omega` times as far as the transform
 *   asks, which is standard successive over-relaxation and gives up the descent
 *   guarantee in exchange for covering more ground per pass.
 *
 * Measured together, at eight sweeps on a crowd that keeps reporting: 2.56 m of
 * error became 1.90 m at identical cost.
 *
 * How far to push `omega` is not one question but two, and they do not agree.
 * On a **standing** graph, solved to convergence, 1.5 gets marginally further
 * than 1.0 and 1.8 gets *less* far — over-relaxation is not accelerating
 * convergence here, whatever the textbook case says. On a **moving** graph it is
 * the opposite: 1.8 tracks a target that keeps shifting better than 1.5 does,
 * because covering more ground per pass is what tracking rewards. 1.5 is the
 * value that is better than 1.0 in both, which beats being much better in one
 * and worse in the other on a workload that is some of each.
 *
 * Numerator and denominator are kept **per axis**, because the anchor is not
 * isotropic: a GPS fix is far better across the ground than in height, and
 * collapsing that into one weight would either throw away good horizontal
 * information or believe bad vertical information.
 */
export function guttman(state: MdsState, options: GuttmanOptions): GuttmanResult {
  const { positions, anchors, anchorWeights, graph, scale } = state

  let maxDisplacement = 0
  let sampleCounter = 0
  const samples: Sample[] = []

  for (const slot of state.slots) {
    const base = slot * 3
    const x = positions[base] ?? 0
    const y = positions[base + 1] ?? 0
    const z = positions[base + 2] ?? 0

    // Two zeros mean nothing pins this point independently. It is still held by
    // its distances, and a point held by nothing keeps the position it has.
    const horizontal = anchorWeights[slot * 2] ?? 0
    const vertical = anchorWeights[slot * 2 + 1] ?? 0

    let numeratorX = horizontal * (anchors[base] ?? 0)
    let numeratorY = horizontal * (anchors[base + 1] ?? 0)
    let numeratorZ = vertical * (anchors[base + 2] ?? 0)

    let denominatorXY = horizontal
    let denominatorZ = vertical

    const from = graph.offsets[slot] ?? 0
    const to = graph.offsets[slot + 1] ?? 0

    for (let edge = from; edge < to; edge++) {
      const other = (graph.neighbour[edge] ?? 0) * 3
      const measured = graph.distance[edge] ?? 0

      const otherX = positions[other] ?? 0
      const otherY = positions[other + 1] ?? 0
      const otherZ = positions[other + 2] ?? 0

      const deltaX = x - otherX
      const deltaY = y - otherY
      const deltaZ = z - otherZ

      const norm = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ)

      const residual = norm - measured
      const sigma = sigmaAt(scale, measured)

      const weight = edgeWeight(measured, scale) * robustFactor(residual, sigma, options.huberKnee)

      // Two points on top of each other have no direction between them, and
      // inventing one would be picking a random answer and calling it a fit.
      // Pulling towards the neighbour itself leaves the pair to be separated by
      // whatever else is holding them.
      const unit = norm > COINCIDENT_M ? measured / norm : 0

      numeratorX += weight * (otherX + deltaX * unit)
      numeratorY += weight * (otherY + deltaY * unit)
      numeratorZ += weight * (otherZ + deltaZ * unit)

      denominatorXY += weight
      denominatorZ += weight

      if (sampleCounter++ % options.samplingStride === 0) {
        samples.push({ distance: measured, residual })
      }
    }

    // Nothing at all holds this point: no anchor, no edges. Leaving it where it
    // is beats dividing by zero and beats moving it to the origin.
    if (denominatorXY <= 0 || denominatorZ <= 0) continue

    const movedX = (numeratorX / denominatorXY - x) * options.omega
    const movedY = (numeratorY / denominatorXY - y) * options.omega
    const movedZ = (numeratorZ / denominatorZ - z) * options.omega

    positions[base] = x + movedX
    positions[base + 1] = y + movedY
    positions[base + 2] = z + movedZ

    const displacement = Math.sqrt(movedX * movedX + movedY * movedY + movedZ * movedZ)

    if (displacement > maxDisplacement) maxDisplacement = displacement
  }

  return { maxDisplacement, samples }
}
