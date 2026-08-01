import type { Vector3 } from '@pollo/contracts'
import { rimGeometry, type Seat, stadium, tiers, ZONE_COUNT } from './bowl.js'

/**
 * What a patch of the bowl does to a GNSS fix. Per zone rather than per device —
 * see ./README.md#what-a-seat-can-see-of-the-sky.
 */
export interface Zone {
  index: number
  seats: number
  centroid: Vector3
  /** Share of the hemisphere not blocked by concrete, in [0, 1]. */
  skyFraction: number
  hdop: number
  vdop: number
  /** Standard deviation of the well-behaved part of the error, in meters. */
  sigmaHorizontal: number
  sigmaVertical: number
  /** How readily this patch falls into a reflected fix, in [0, 1]. */
  multipathSusceptibility: number
  /** Unit vector a reflected fix is displaced along. */
  biasDirection: Vector3
}

/** One satellite's range error before geometry multiplies it. See the parameter table. */
const SIGMA_UERE = 4

/** How many directions the sky is probed in per zone. */
const AZIMUTH_SAMPLES = 32

function superellipseValue(x: number, y: number, a: number, b: number, exponent: number) {
  return Math.abs(x / a) ** exponent + Math.abs(y / b) ** exponent
}

/**
 * Where a ray leaving `origin` first meets the superellipse. March then bisect:
 * a closed form exists only for a few exponents, and this runs once at startup.
 */
function firstCrossing(
  origin: { x: number; y: number },
  direction: { x: number; y: number },
  a: number,
  b: number,
  maxDistance = 400,
) {
  const at = (distance: number) =>
    superellipseValue(
      origin.x + direction.x * distance,
      origin.y + direction.y * distance,
      a,
      b,
      stadium.planExponent,
    ) - 1

  let previousDistance = 0
  let previousValue = at(0)

  for (let distance = 1; distance <= maxDistance; distance += 1) {
    const value = at(distance)

    if (previousValue <= 0 !== value <= 0) {
      let low = previousDistance
      let high = distance

      for (let i = 0; i < 24; i++) {
        const middle = (low + high) / 2
        if (at(low) <= 0 === at(middle) <= 0) low = middle
        else high = middle
      }

      return (low + high) / 2
    }

    previousDistance = distance
    previousValue = value
  }

  return maxDistance
}

/**
 * The elevation below which a seat sees concrete instead of sky. The rim and the
 * canopy both take away *low* satellites — see ./README.md#the-mask-where-concrete-replaces-sky.
 */
function elevationMask(point: Vector3, azimuth: number) {
  const rim = rimGeometry()
  const direction = { x: Math.cos(azimuth), y: Math.sin(azimuth) }

  const toRim = firstCrossing(point, direction, rim.a, rim.b)
  const structural = Math.max(0, Math.atan2(rim.height - point.z, Math.max(toRim, 0.5)))

  const roofInnerA = rim.a - stadium.roofDepth
  const roofInnerB = rim.b - stadium.roofDepth
  const underRoof =
    superellipseValue(point.x, point.y, roofInnerA, roofInnerB, stadium.planExponent) > 1

  // Under the canopy, whatever lies outward is roof all the way past the rim;
  // only the ray back over the pitch escapes, and it escapes past the inner
  // edge.
  const heading = Math.atan2(point.y, point.x)
  const outward = Math.cos(azimuth - heading) > 0

  if (underRoof && outward) return Math.PI / 2

  const toRoofEdge = firstCrossing(point, direction, roofInnerA, roofInnerB)
  const roof = Math.max(0, Math.atan2(stadium.roofHeight - point.z, Math.max(toRoofEdge, 0.5)))

  return Math.max(structural, Math.min(roof, Math.PI / 2))
}

/** Integrating cos(e) from the mask to the zenith gives `1 − sin(mask)` per azimuth. */
function skyFractionAt(point: Vector3) {
  let total = 0

  for (let i = 0; i < AZIMUTH_SAMPLES; i++) {
    const azimuth = (i / AZIMUTH_SAMPLES) * 2 * Math.PI
    total += 1 - Math.sin(elevationMask(point, azimuth))
  }

  return Math.max(0.05, total / AZIMUTH_SAMPLES)
}

/**
 * The vertical is always worse and degrades faster, because no satellite is ever
 * below the horizon. Exponents are fitted, not derived — see
 * ./README.md#from-sky-fraction-to-dop.
 */
function dilutionOfPrecision(skyFraction: number) {
  // The ceilings are load-bearing: an unbounded fit runs away under the canopy,
  // while a real receiver either holds or stops reporting a fix at all.
  return {
    hdop: Math.min(4, 0.8 / skyFraction ** 1.1),
    vdop: Math.min(9, 1.4 / skyFraction ** 1.45),
  }
}

/**
 * Inward over the pitch, and down: the blocked satellites are the outward ones.
 * See ./README.md#where-a-reflected-fix-goes.
 */
function biasDirection(centroid: Vector3): Vector3 {
  const heading = Math.atan2(centroid.y, centroid.x)
  const inward = { x: -Math.cos(heading), y: -Math.sin(heading), z: -0.5 }
  const length = Math.hypot(inward.x, inward.y, inward.z)

  return { x: inward.x / length, y: inward.y / length, z: inward.z / length }
}

export function buildZones(seats: readonly Seat[]): Zone[] {
  const sums = Array.from({ length: ZONE_COUNT }, () => ({ x: 0, y: 0, z: 0, count: 0 }))

  for (const seat of seats) {
    const sum = sums[seat.zone]
    if (!sum) continue

    sum.x += seat.point.x
    sum.y += seat.point.y
    sum.z += seat.point.z
    sum.count += 1
  }

  const roofedTiers = new Set(seats.filter(seat => tiers[seat.tier].roofed).map(seat => seat.zone))

  return sums.map((sum, index) => {
    const seatCount = sum.count
    const centroid: Vector3 =
      seatCount === 0
        ? { x: 0, y: 0, z: 0 }
        : { x: sum.x / seatCount, y: sum.y / seatCount, z: sum.z / seatCount }

    const skyFraction = seatCount === 0 ? 1 : skyFractionAt(centroid)
    const { hdop, vdop } = dilutionOfPrecision(skyFraction)

    const exposure = 1 - skyFraction
    const susceptibility = Math.min(1, exposure * (roofedTiers.has(index) ? 1.4 : 1))

    return {
      index,
      seats: seatCount,
      centroid,
      skyFraction,
      hdop,
      vdop,
      sigmaHorizontal: hdop * SIGMA_UERE,
      sigmaVertical: vdop * SIGMA_UERE,
      multipathSusceptibility: susceptibility,
      biasDirection: biasDirection(centroid),
    }
  })
}
