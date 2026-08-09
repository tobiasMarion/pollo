import type { Random } from '../noise/random.js'
import { PHONE_HEIGHT, SEAT_PITCH, type Seat, seatAt } from './seat.js'
import type { Venue } from './venue.js'

/** The rectangle the rows are wrapped around, in meters. A football pitch. */
export const PITCH = { length: 105, width: 68 }

/** Clearance between the touchline and the first row. */
const FIRST_ROW_OFFSET = 8

/** How high the first row sits above the pitch. */
const FIRST_ROW_HEIGHT = 1

/** How far out each row steps, and how far up. Together these are the rake. */
const ROW_DEPTH = 0.8
const RISE = 0.45

/** How tall a bank of seating gets before it is widened instead. */
const MAX_ROWS = 45

/**
 * Where `distance` along the perimeter of a rectangle lands, starting at the
 * near right corner and running anticlockwise.
 *
 * A rectangle rather than the rounded bowl a stadium really is: the rounding
 * costs an arc-length integral per row and buys nothing the crowd can tell
 * apart, because what reaches the worker is distances between neighbours and
 * those are set by the row spacing either way.
 */
function pointOnRectangle(distance: number, a: number, b: number) {
  const right = 2 * b
  const top = right + 2 * a
  const left = top + 2 * b

  if (distance < right) return { x: a, y: -b + distance }
  if (distance < top) return { x: a - (distance - right), y: b }
  if (distance < left) return { x: -a, y: b - (distance - top) }

  return { x: -a + (distance - left), y: -b }
}

/**
 * How wide the block has to be to seat the crowd in a stand that is roughly as
 * deep as it is wide.
 *
 * A crowd fills a *section* of a ground, not a bracelet of one row around the
 * whole pitch — and the difference is not cosmetic. Spread five hundred people
 * around a touchline and each of them can hear exactly two neighbours, which
 * leaves the worker a chain to reconstruct rather than a surface.
 */
function sectionWidth(capacity: number) {
  const rows = Math.min(
    MAX_ROWS,
    Math.max(1, Math.round(Math.sqrt((capacity * SEAT_PITCH) / ROW_DEPTH))),
  )

  return Math.ceil(capacity / rows)
}

/**
 * Rows around a pitch, each one a step further out and a step higher. The crowd
 * fills a block behind the near touchline, and only wraps around the ground once
 * a block would be wider than the ground is long.
 */
export const stands: Venue = {
  description: 'Rows around a pitch, each one a step further out and a step higher.',

  // Worse than open ground: half the sky is stand, and the concrete behind is
  // what a fix ends up leaning on.
  sigma: { horizontal: 6, vertical: 12 },

  build(capacity: number, random: Random): Seat[] {
    const seats: Seat[] = []
    const width = sectionWidth(capacity)

    for (let row = 0; seats.length < capacity; row++) {
      const offset = FIRST_ROW_OFFSET + row * ROW_DEPTH
      const a = PITCH.length / 2 + offset
      const b = PITCH.width / 2 + offset
      const z = FIRST_ROW_HEIGHT + row * RISE + PHONE_HEIGHT

      const perimeter = 4 * (a + b)
      const places = Math.min(Math.floor(perimeter / SEAT_PITCH), width)

      // Centred on the middle of the near touchline, which is where the block
      // of seats sits.
      const middle = 4 * b + 3 * a

      for (let place = 0; place < places; place++) {
        const along = middle + (place - (places - 1) / 2) * SEAT_PITCH
        const { x, y } = pointOnRectangle(((along % perimeter) + perimeter) % perimeter, a, b)

        seats.push(seatAt({ x, y, z }, row, random))
      }
    }

    return seats
  },
}
