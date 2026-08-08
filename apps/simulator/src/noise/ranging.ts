import type { Random } from './random.js'

/** How much of a measurement is error, as a fraction of the distance measured. */
const RELATIVE_SIGMA = 0.12

/** And a floor under it: even phones touching each other disagree by centimetres. */
const ABSOLUTE_SIGMA = 0.15

/** Best case chance of hearing a peer at all, with the phone in your hand. */
const PEAK_DETECTION = 0.98

/** How sharply that chance falls off across the radio's range. */
const DETECTION_DECAY = 2.2

/**
 * The longest measurement worth putting on the wire, as a multiple of the range.
 *
 * The tail has to go somewhere. Measurements are dropped rather than clamped —
 * an edge squashed against the limit is a confident lie, while a missing edge is
 * just a missing edge, and the worker meets the same censored distribution in
 * the field.
 */
const MAX_EDGE_FACTOR = 1.5

/**
 * What one phone measures when it tries to range another.
 *
 * Error proportional to distance, because that is what every short-range
 * technique has in common — a metre of it, whether the underlying trick is
 * signal strength, time of flight or a body in the way, costs roughly a fixed
 * fraction of that metre.
 */
export class Ranging {
  constructor(
    private readonly random: Random,
    private readonly range: number,
  ) {}

  /** Meters, or `null` when nothing was heard — which is what `null` means on the wire. */
  measure(trueDistance: number): number | null {
    if (trueDistance > this.range) return null

    const reach = trueDistance / this.range
    const heard = PEAK_DETECTION * Math.exp(-DETECTION_DECAY * reach * reach)

    if (!this.random.bool(heard)) return null

    const sigma = ABSOLUTE_SIGMA + RELATIVE_SIGMA * trueDistance
    const measured = trueDistance + this.random.gaussian() * sigma

    if (measured > this.range * MAX_EDGE_FACTOR) return null

    // A negative distance is not a bad measurement, it is a nonsensical one, and
    // no receiver would report it.
    return Math.max(0.01, measured)
  }
}
