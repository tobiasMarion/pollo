import type { Vector3 } from '@pollo/contracts'
import { type OuLayer, Vector3Ou } from './ou.js'
import type { Random } from './random.js'

/**
 * How wrong a fix is in a given kind of room, in meters. Declared by the venue,
 * because the building is what decides it.
 */
export interface ErrorBudget {
  horizontal: number
  vertical: number
}

/**
 * Unit-variance drift — the venue's budget scales it into meters. Two time
 * scales rather than one: a fix jitters over seconds and also wanders over the
 * afternoon, and a single τ produces an error that oscillates at exactly one
 * rate, which nothing real does.
 */
const HORIZONTAL_LAYERS: OuLayer[] = [
  { tau: 15, sigma: Math.SQRT1_2 },
  { tau: 400, sigma: Math.SQRT1_2 },
]

/** Height remembers longer: it turns over with the constellation, not the phone. */
const VERTICAL_LAYERS: OuLayer[] = [
  { tau: 45, sigma: Math.SQRT1_2 },
  { tau: 1200, sigma: Math.SQRT1_2 },
]

/** How often the shared field advances. Every shard steps it on this grid. */
export const FIELD_TICK_SECONDS = 0.25

/** How much better or worse than the venue's budget a given handset is. */
const QUALITY_RANGE = { min: 0.7, max: 1.4 }

/** How honest a receiver is about its own uncertainty. Most are optimistic. */
const OPTIMISM_RANGE = { min: 0.7, max: 1.1 }

/**
 * The part of the error the whole crowd sees alike, and the part a naive
 * simulator drops.
 *
 * Phones standing five metres apart do not get independent fixes: they are
 * listening to the same satellites through the same sky, so most of what they
 * get wrong, they get wrong together. That matters more than it sounds — a
 * common offset moves the whole cloud without deforming it, which is exactly
 * the error a reconstruction from distances *cannot* see and the one raw GPS
 * suffers in full.
 */
export class SharedErrorField {
  private readonly common: Vector3Ou
  private tick = 0

  constructor(random: Random) {
    this.common = new Vector3Ou(HORIZONTAL_LAYERS, VERTICAL_LAYERS, random)
  }

  /**
   * By absolute tick, not by elapsed seconds: a stalled thread replays what it
   * missed, so every shard reaches the same field at the same moment of the run.
   */
  advanceTo(tick: number) {
    while (this.tick < tick) {
      this.common.step(FIELD_TICK_SECONDS)
      this.tick += 1
    }
  }

  get value(): Vector3 {
    return this.common.value
  }
}

export interface GnssReading {
  /** What to add to the true position to get the reported one, in meters. */
  offset: Vector3
  /** What the device claims about itself — see the note on `sample`. */
  horizontalAccuracy: number
  verticalAccuracy: number
}

/** One phone's view of the sky: what everyone gets wrong, plus what only it does. */
export class DeviceGnss {
  private readonly own: Vector3Ou

  /** Amplitudes, not shares: variance is what adds, so these are square roots. */
  private readonly commonWeight: number
  private readonly ownWeight: number

  private readonly quality: number
  private readonly optimism: number

  constructor(
    private readonly budget: ErrorBudget,
    random: Random,
    commonModeShare: number,
  ) {
    this.own = new Vector3Ou(HORIZONTAL_LAYERS, VERTICAL_LAYERS, random)

    this.commonWeight = Math.sqrt(commonModeShare)
    this.ownWeight = Math.sqrt(1 - commonModeShare)

    this.quality = random.between(QUALITY_RANGE.min, QUALITY_RANGE.max)
    this.optimism = random.between(OPTIMISM_RANGE.min, OPTIMISM_RANGE.max)
  }

  /**
   * The accuracies reported are deliberately not the truth. A phone publishes an
   * estimate of its own uncertainty, and that estimate is itself wrong — usually
   * optimistic. Anything downstream that trusts the number has to meet one that
   * cannot be trusted, or it has been tested against a courtesy.
   */
  sample(field: SharedErrorField, dt: number): GnssReading {
    const own = this.own.step(dt)
    const common = field.value

    const horizontal = this.budget.horizontal
    const vertical = this.budget.vertical

    const mix = (shared: number, mine: number, sigma: number) =>
      sigma * this.commonWeight * shared + sigma * this.quality * this.ownWeight * mine

    return {
      offset: {
        x: mix(common.x, own.x, horizontal),
        y: mix(common.y, own.y, horizontal),
        z: mix(common.z, own.z, vertical),
      },
      horizontalAccuracy: horizontal * this.optimism,
      verticalAccuracy: vertical * this.optimism,
    }
  }
}
