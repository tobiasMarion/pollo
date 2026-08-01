import type { Vector3 } from '@pollo/contracts'
import type { Random } from '../noise/random.js'

export interface TierSpec {
  /** Rows of seating in this ring. */
  rows: number
  /** How far out each row steps, in meters. */
  rowDepth: number
  /** How far up each row steps — with `rowDepth` this is the rake. */
  rise: number
  /** Distance from the pitch boundary to the first row. */
  startOffset: number
  /** Height of the first row above the pitch. */
  startHeight: number
  /** Whether the canopy reaches over this ring. */
  roofed: boolean
}

/**
 * A record rather than a list, in the spirit of the contracts package: the
 * names, the iteration order and the per-tier lookups all derive from these
 * keys.
 */
export const tiers = {
  LOWER: {
    rows: 30,
    rowDepth: 0.8,
    rise: 0.45,
    startOffset: 8,
    startHeight: 1,
    roofed: false,
  },
  UPPER: {
    rows: 25,
    rowDepth: 0.8,
    rise: 0.52,
    startOffset: 44,
    startHeight: 16,
    roofed: true,
  },
} as const satisfies Record<string, TierSpec>

export type TierName = keyof typeof tiers

export const tierNames = Object.keys(tiers) as TierName[]

export const stadium = {
  pitchLength: 105,
  pitchWidth: 68,
  /** Rounded rectangle, not an ellipse — see ./README.md#the-bowl. */
  planExponent: 4,
  /** Seat width — how densely the perimeter of a row is filled. */
  seatPitch: 0.5,
  /** Seats between stairways. */
  aisleEvery: 40,
  /** How many seats a stairway costs. */
  aisleWidth: 3,
  /** A phone is held at chest height, and the crowd is standing. */
  phoneHeight: 1.4,
  /** Where the canopy sits, and how far in from the outer rim it reaches. */
  roofHeight: 44,
  roofDepth: 26,
  /** How much of a seat's own position is not exactly on the grid. */
  seatJitter: 0.05,
} as const

export interface Seat {
  /** Ground truth in the field frame: meters east, north and up of the origin. */
  point: Vector3
  tier: TierName
  row: number
  /** Outward-facing direction of the seat, in radians. */
  azimuth: number
  /** Index into the zone table — what decides this seat's error budget. */
  zone: number
}

/** Semi-axes of the superellipse a row follows. */
function rowAxes(tier: TierSpec, row: number) {
  const offset = tier.startOffset + row * tier.rowDepth

  return { a: stadium.pitchLength / 2 + offset, b: stadium.pitchWidth / 2 + offset }
}

export function rowHeight(tier: TierSpec, row: number) {
  return tier.startHeight + row * tier.rise
}

/** The outermost row of the outermost tier — the rim that blocks the sky. */
export function rimGeometry() {
  const outer = tiers[tierNames[tierNames.length - 1] as TierName]
  const lastRow = outer.rows - 1

  return { ...rowAxes(outer, lastRow), height: rowHeight(outer, lastRow) }
}

/** Signed-power form: a naive root loses the sign where the curve crosses an axis. */
export function superellipsePoint(t: number, a: number, b: number, exponent: number) {
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const power = 2 / exponent

  return {
    x: Math.sign(cos) * Math.abs(cos) ** power * a,
    y: Math.sign(sin) * Math.abs(sin) ** power * b,
  }
}

/**
 * Walks a row at constant `seatPitch`. Stepping `t` evenly would bunch seats
 * into the corners — see ./README.md#seats-are-placed-by-arc-length-not-by-angle.
 */
function seatAnglesAlongRow(a: number, b: number, samples = 4_000) {
  const cumulative = new Float64Array(samples + 1)
  let previous = superellipsePoint(0, a, b, stadium.planExponent)

  for (let i = 1; i <= samples; i++) {
    const point = superellipsePoint((i / samples) * 2 * Math.PI, a, b, stadium.planExponent)
    cumulative[i] =
      (cumulative[i - 1] ?? 0) + Math.hypot(point.x - previous.x, point.y - previous.y)
    previous = point
  }

  const perimeter = cumulative[samples] ?? 0
  const seats = Math.floor(perimeter / stadium.seatPitch)
  const angles: number[] = []

  let cursor = 1

  for (let seat = 0; seat < seats; seat++) {
    const target = seat * stadium.seatPitch

    while (cursor < samples && (cumulative[cursor] ?? 0) < target) cursor++

    const before = cumulative[cursor - 1] ?? 0
    const after = cumulative[cursor] ?? before
    const span = after - before
    const withinSegment = span === 0 ? 0 : (target - before) / span

    angles.push(((cursor - 1 + withinSegment) / samples) * 2 * Math.PI)
  }

  return angles
}

/** Angular sectors and row bands the zone table is cut along. */
export const ANGULAR_SECTORS = 8
export const ROW_BANDS = 3

export function zoneIndex(tier: TierName, row: number, rows: number, azimuth: number) {
  const tierOffset = tierNames.indexOf(tier) * ROW_BANDS * ANGULAR_SECTORS
  const band = Math.min(ROW_BANDS - 1, Math.floor((row / rows) * ROW_BANDS))
  const normalized = ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const sector = Math.min(
    ANGULAR_SECTORS - 1,
    Math.floor((normalized / (2 * Math.PI)) * ANGULAR_SECTORS),
  )

  return tierOffset + band * ANGULAR_SECTORS + sector
}

export const ZONE_COUNT = tierNames.length * ROW_BANDS * ANGULAR_SECTORS

/**
 * Every seat in the stadium, in the field frame. The gaps and the jitter are
 * deliberate — see ./README.md#stairways-are-cut-out.
 */
export function buildSeats(random: Random): Seat[] {
  const seats: Seat[] = []

  for (const name of tierNames) {
    const tier = tiers[name]

    for (let row = 0; row < tier.rows; row++) {
      const { a, b } = rowAxes(tier, row)
      const height = rowHeight(tier, row) + stadium.phoneHeight
      const angles = seatAnglesAlongRow(a, b)

      // Offsetting the stairways per row keeps them as radial lanes rather than
      // a spiral, which is what a real gangway looks like from above.
      const aisleShift = row % stadium.aisleEvery

      for (let index = 0; index < angles.length; index++) {
        const withinBlock = (index + aisleShift) % stadium.aisleEvery
        if (withinBlock < stadium.aisleWidth) continue

        const angle = angles[index] ?? 0
        const point = superellipsePoint(angle, a, b, stadium.planExponent)
        const jitter = stadium.seatJitter

        seats.push({
          point: {
            x: point.x + random.between(-jitter, jitter),
            y: point.y + random.between(-jitter, jitter),
            z: height + random.between(-jitter, jitter),
          },
          tier: name,
          row,
          azimuth: Math.atan2(point.y, point.x),
          zone: zoneIndex(name, row, tier.rows, Math.atan2(point.y, point.x)),
        })
      }
    }
  }

  return seats
}

/**
 * Which seats are taken. Weighted rather than uniform, by Efraimidis–Spirakis —
 * see ./README.md#filling-it.
 */
export function occupySeats(seats: readonly Seat[], count: number, random: Random): number[] {
  if (count > seats.length) {
    throw new Error(
      `The bowl holds ${seats.length} seats and ${count} were asked for — lower --clients.`,
    )
  }

  const sectorAppeal = Array.from({ length: ZONE_COUNT }, () => random.between(0.35, 1))

  const keyed = seats.map((seat, index) => {
    // The upper ring holds more seats than the lower one but is the last to
    // fill, so its weight has to undo that head start before it biases anything.
    const tierAppeal = seat.tier === 'LOWER' ? 1 : 0.4
    const weight = (sectorAppeal[seat.zone] ?? 1) * tierAppeal

    return { index, key: random.float() ** (1 / weight) }
  })

  keyed.sort((left, right) => right.key - left.key)

  return keyed.slice(0, count).map(entry => entry.index)
}
