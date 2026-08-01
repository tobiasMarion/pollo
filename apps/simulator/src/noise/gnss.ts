import type { Vector3 } from '@pollo/contracts'
import type { Zone } from '../crowd/zones.js'
import { Multipath } from './multipath.js'
import { type OuLayer, Vector3Ou } from './ou.js'
import { deriveSeed, Random } from './random.js'

/** Unit-variance drift; the zone scales it to meters. See ./README.md#layering. */
const HORIZONTAL_LAYERS: OuLayer[] = [
  { tau: 15, sigma: Math.SQRT1_2 },
  { tau: 400, sigma: Math.SQRT1_2 },
]

/** The vertical remembers longer: it turns over as the constellation moves, not the phone. */
const VERTICAL_LAYERS: OuLayer[] = [
  { tau: 45, sigma: Math.SQRT1_2 },
  { tau: 1200, sigma: Math.SQRT1_2 },
]

/** How often the shared field advances. Every shard steps it on this grid. */
export const FIELD_TICK_SECONDS = 0.25

/**
 * The part of the error the crowd shares — the largest part of it, and the one a
 * naive simulator drops. See ./README.md#what-the-crowd-shares.
 */
export class SharedErrorField {
  private readonly common: Vector3Ou
  private readonly sectors: Vector3Ou[]
  private tick = 0

  constructor(seed: number, zoneCount: number) {
    this.common = new Vector3Ou(HORIZONTAL_LAYERS, VERTICAL_LAYERS, new Random(deriveSeed(seed, 1)))
    this.sectors = Array.from(
      { length: zoneCount },
      (_, zone) =>
        new Vector3Ou(
          HORIZONTAL_LAYERS,
          VERTICAL_LAYERS,
          new Random(deriveSeed(seed, 1_000 + zone)),
        ),
    )
  }

  /**
   * By absolute tick, not elapsed seconds: a stalled thread replays what it
   * missed, and a large step is not the same random path.
   */
  advanceTo(tick: number) {
    while (this.tick < tick) {
      this.common.step(FIELD_TICK_SECONDS)
      for (const sector of this.sectors) sector.step(FIELD_TICK_SECONDS)
      this.tick += 1
    }
  }

  commonValue() {
    return this.common.value
  }

  sectorValue(zone: number) {
    return this.sectors[zone]?.value ?? { x: 0, y: 0, z: 0 }
  }
}

export interface GnssReading {
  /** What to add to the true position to get the reported one, in meters. */
  offset: Vector3
  /** What the device claims about itself — see the note in `sample`. */
  horizontalAccuracy: number
  verticalAccuracy: number
  reflected: boolean
}

/** One device's view: the shared parts scaled by its zone, its own, and the concrete. */
export class DeviceGnss {
  private readonly own: Vector3Ou
  private readonly multipath: Multipath
  private readonly weights: { common: number; sector: number; own: number }
  private readonly verticalWeights: { common: number; sector: number; own: number }
  private readonly optimism: number

  constructor(
    private readonly zone: Zone,
    random: Random,
    commonModeShare: number,
  ) {
    this.own = new Vector3Ou(HORIZONTAL_LAYERS, VERTICAL_LAYERS, random)
    this.multipath = new Multipath(zone, random)

    this.weights = varianceSplit(commonModeShare)
    // Height is the most common-mode quantity a constellation produces.
    this.verticalWeights = varianceSplit(Math.min(0.95, commonModeShare * 1.15))

    // Receivers differ in how badly they estimate their own uncertainty.
    this.optimism = random.between(0.7, 1.1)
  }

  /**
   * The accuracies returned are deliberately not the truth: a phone cannot know
   * about a reflection it did not detect. See
   * ./README.md#the-reported-accuracy-lies-deliberately.
   */
  sample(field: SharedErrorField, dt: number): GnssReading {
    const own = this.own.step(dt)
    const reflection = this.multipath.step(dt)

    const common = field.commonValue()
    const sector = field.sectorValue(this.zone.index)

    const horizontal = this.zone.sigmaHorizontal * reflection.sigmaScale
    const vertical = this.zone.sigmaVertical * reflection.sigmaScale

    return {
      offset: {
        x: horizontal * mix(this.weights, common.x, sector.x, own.x) + reflection.bias.x,
        y: horizontal * mix(this.weights, common.y, sector.y, own.y) + reflection.bias.y,
        z: vertical * mix(this.verticalWeights, common.z, sector.z, own.z) + reflection.bias.z,
      },
      horizontalAccuracy: this.zone.sigmaHorizontal * this.optimism,
      verticalAccuracy: this.zone.sigmaVertical * this.optimism,
      reflected: reflection.reflected,
    }
  }
}

/** How much of the shared error is a sector's own rather than the venue's. */
const SECTOR_SHARE_OF_SHARED = 0.2

/**
 * Amplitudes, not shares: variance is what adds, so these are square roots.
 * Mixing by the shares would quietly shrink the total error.
 */
function varianceSplit(shared: number) {
  const sector = shared * SECTOR_SHARE_OF_SHARED

  return {
    common: Math.sqrt(shared - sector),
    sector: Math.sqrt(sector),
    own: Math.sqrt(1 - shared),
  }
}

function mix(
  weights: { common: number; sector: number; own: number },
  common: number,
  sector: number,
  own: number,
) {
  return weights.common * common + weights.sector * sector + weights.own * own
}
