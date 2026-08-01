import type { Random } from './random.js'

/** Free space is 2; every metre of a packed path costs another body. */
const PATH_LOSS_EXPONENT = 2.6

/** Shadow fading, in dB — zero-mean here, so unbiased in the log domain. */
const SHADOWING_SIGMA_DB = 6

/** How far a line of sight travels before a body is likely to cross it. */
const BODY_MEAN_FREE_PATH = 8

/** What a blocked path costs, in dB. Water absorbs 2.4 GHz well, so this is one-sided. */
const BLOCKAGE_LOSS_SHAPE = 3
const BLOCKAGE_LOSS_SCALE = 3.5

/** Best-case chance of hearing a peer at all, at zero distance. */
const PEAK_DETECTION = 0.98

/** How sharply that chance decays across the radio range. */
const DETECTION_DECAY = 2.2

export interface RangingSample {
  /** Meters, or null when nothing was heard — which is what `null` means on the wire. */
  distance: number | null
  /** Whether a body stood in the way. Diagnostics only; never sent. */
  blocked: boolean
}

const UNHEARD: RangingSample = { distance: null, blocked: false }

/**
 * What one device measures when it tries to range another — a power measurement
 * inverted through a propagation model, not a distance with a small error on it.
 * This is what the reconstruction lives on; see ./README.md#ranging.
 */
export class Ranging {
  /**
   * `range` bounds the true distance; `maxReported` bounds what goes on the wire.
   * Not the same limit — see ./README.md#two-limits-and-they-are-not-the-same-limit.
   */
  constructor(
    private readonly random: Random,
    private readonly range: number,
    private readonly maxReported: number = Number.POSITIVE_INFINITY,
  ) {}

  /** `crowdFactor` 1 is a full stand; 0 is a clear line of sight, which only tests ask for. */
  measure(trueDistance: number, crowdFactor = 1): RangingSample {
    if (trueDistance > this.range) return UNHEARD

    const reach = trueDistance / this.range
    const heard = PEAK_DETECTION * Math.exp(-DETECTION_DECAY * reach * reach)

    if (!this.random.bool(heard)) return UNHEARD

    const blockingChance =
      crowdFactor <= 0 ? 0 : 1 - Math.exp(-trueDistance / (BODY_MEAN_FREE_PATH / crowdFactor))
    const blocked = this.random.bool(blockingChance)

    // Shadow fading is symmetric; blockage only ever adds loss, which is what
    // makes a blocked link read as too far rather than merely noisy.
    const fading = this.random.gaussian() * SHADOWING_SIGMA_DB
    const blockage = blocked ? this.random.gamma(BLOCKAGE_LOSS_SHAPE, BLOCKAGE_LOSS_SCALE) : 0

    const decibels = fading + blockage
    const distance = trueDistance * 10 ** (decibels / (10 * PATH_LOSS_EXPONENT))

    if (distance > this.maxReported) return { distance: null, blocked }

    return { distance, blocked }
  }
}
