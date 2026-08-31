import { type Scale, sigmaAt } from '../sigma/index.js'

/**
 * The weight of one measured distance: one over its variance, which is what
 * makes the fit a maximum-likelihood estimate rather than an average of things
 * that happen to be numbers.
 *
 * A measurement three times as uncertain pulls a ninth as hard.
 */
export function edgeWeight(distance: number, scale: Scale) {
  const sigma = sigmaAt(scale, distance)

  return 1 / (sigma * sigma)
}

/**
 * How much a residual counts once it is too large to be noise.
 *
 * Squared error says a residual ten sigma out is a hundred times as important
 * as one at one sigma. In a crowd it is the opposite: a distance that far off
 * is a reflection, a wall, or a pair that never should have been measured, and
 * the one thing it must not do is drag its neighbourhood after it. Past the
 * knee the residual counts linearly instead — Huber, as an IRLS weight, so it
 * multiplies straight into the edge weight and the sweep does not change shape.
 *
 * The knee is in units of sigma, so it moves with the sensor rather than with
 * the venue.
 */
export function robustFactor(residual: number, sigma: number, knee: number) {
  const normalized = Math.abs(residual) / sigma

  return normalized <= knee ? 1 : knee / normalized
}

export interface AnchorWeights {
  horizontal: number
  vertical: number
}

/** An accuracy this good is a receiver bragging, and dividing by its square hurts. */
const MIN_ACCURACY_M = 0.1

/**
 * What a device's own reading is worth, per axis.
 *
 * One over variance, from the accuracies the device reported. That is the only
 * statement a handset ever makes about its own confidence, and believing it is
 * cheaper and better than guessing. Horizontal and vertical are kept apart
 * because they are not remotely alike: a fix good to five metres across the
 * ground is routinely twelve metres out in height.
 *
 * `scale` is global trust in the whole class of reading. Anchors assume
 * independent error, and GNSS error is not independent — phones a few metres
 * apart read the same satellites through the same sky, so most of what they get
 * wrong they get wrong together. Independent anchors over-count that agreement,
 * and this is the dial that answers for it until the shared part is estimated
 * outright. It belongs to whoever is solving, not to this package.
 *
 * **The anchor does not fade as a device accumulates evidence**, which was the
 * obvious next idea and is wrong. The argument for fading is real — once a
 * device is held by a dozen measured distances, its own reading is the worst
 * input in its fit. The trouble is what the anchors are also doing: they are the
 * only thing that fixes the frame. Distances give a shape and say nothing about
 * where that shape sits or which way it faces, so relaxing them lets the whole
 * cloud drift and turn, and it scores worse for a shape that is better.
 * Measured, on a crowd of a hundred and twenty: RMSE went from 2.56 m to 2.93 m.
 * The averaging that fading was reaching for is what `Relaxation` does instead,
 * and it does it without touching the frame.
 */
export function anchorWeights(
  horizontalAccuracy: number,
  verticalAccuracy: number,
  scale: number,
): AnchorWeights {
  const horizontal = Math.max(horizontalAccuracy, MIN_ACCURACY_M)
  const vertical = Math.max(verticalAccuracy, MIN_ACCURACY_M)

  return {
    horizontal: scale / (horizontal * horizontal),
    vertical: scale / (vertical * vertical),
  }
}
