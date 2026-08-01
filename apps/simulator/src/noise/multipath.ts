import type { Vector3 } from '@pollo/contracts'
import type { Zone } from '../crowd/zones.js'
import type { Random } from './random.js'

/**
 * Mean seconds a device stays clean when its zone is as exposed as a zone gets.
 * Divided by the susceptibility, so a sheltered seat waits proportionally
 * longer for its turn.
 */
const CLEAN_DWELL_AT_FULL_EXPOSURE = 40

/** Mean seconds a reflected fix lasts — as long as the geometry holds. */
const REFLECTED_DWELL = 8

/** Gamma shape for the excursion. Two gives a hump with a tail, not a bell. */
const MAGNITUDE_SHAPE = 2

/** How much the well-behaved part of the error grows while reflected. */
const SIGMA_INFLATION = 2.5

export interface MultipathSample {
  /** Displacement to add to the fix, in meters. Zero while the device is clean. */
  bias: Vector3
  /** Multiplier on the Gaussian part of the error. */
  sigmaScale: number
  reflected: boolean
}

const CLEAN: MultipathSample = { bias: { x: 0, y: 0, z: 0 }, sigmaScale: 1, reflected: false }

/**
 * A two-state Markov chain: taking satellites directly, or reading some off the
 * concrete. A state rather than a spike, because a spike is what a median
 * removes — see ./README.md#reflections.
 */
export class Multipath {
  private reflected = false
  private remaining: number
  private bias: Vector3 = { x: 0, y: 0, z: 0 }

  constructor(
    private readonly zone: Zone,
    private readonly random: Random,
  ) {
    this.remaining = random.exponential(this.cleanDwell())
  }

  private cleanDwell() {
    const exposure = Math.max(this.zone.multipathSusceptibility, 0.02)

    return CLEAN_DWELL_AT_FULL_EXPOSURE / exposure
  }

  /** Near the zone's heading, but not identical — averaging neighbours must not cancel it. */
  private drawBias(): Vector3 {
    const magnitude = this.random.gamma(MAGNITUDE_SHAPE, 7 + 8 * this.zone.multipathSusceptibility)

    const spread = this.random.unitVector()
    const preferred = this.zone.biasDirection

    const direction = {
      x: preferred.x + spread.x * 0.35,
      y: preferred.y + spread.y * 0.35,
      z: preferred.z + spread.z * 0.35,
    }

    const length = Math.hypot(direction.x, direction.y, direction.z) || 1

    return {
      x: (direction.x / length) * magnitude,
      y: (direction.y / length) * magnitude,
      z: (direction.z / length) * magnitude,
    }
  }

  step(dt: number): MultipathSample {
    this.remaining -= dt

    if (this.remaining <= 0) {
      this.reflected = !this.reflected
      this.remaining = this.random.exponential(this.reflected ? REFLECTED_DWELL : this.cleanDwell())
      this.bias = this.reflected ? this.drawBias() : { x: 0, y: 0, z: 0 }
    }

    if (!this.reflected) return CLEAN

    return { bias: this.bias, sigmaScale: SIGMA_INFLATION, reflected: true }
  }
}
