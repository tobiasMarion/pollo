import type { Random } from '../noise/random.js'
import { PHONE_HEIGHT, SEAT_PITCH, type Seat, seatAt } from './seat.js'
import type { Venue } from './venue.js'

/** The stage sits at the origin and the house faces it, out along +y. */
const FIRST_ROW_RADIUS = 8

/** How far back each row steps. */
const ROW_DEPTH = 0.9

/** How wide the house opens around the axis of the stage. */
export const HALF_ANGLE = (55 * Math.PI) / 180

/** Half the central gangway, as an angle. Seats inside it are not there. */
export const AISLE_HALF_ANGLE = (3.5 * Math.PI) / 180

/** How far a balcony reaches back over the level below it. */
const OVERHANG = 4

/**
 * The floor is nearly flat and a balcony is steep, which is the whole reason a
 * balcony exists.
 */
const STALLS_RISE = 0.12
const BALCONY_RISE = 0.45

/** How the house is filled. The floor takes most of it; the top balcony least. */
const SHARES = [0.6, 0.25, 0.15]

/** Where each balcony's floor sits above the stalls. */
const BALCONY_HEIGHTS = [0, 6, 11]

interface Bank {
  seats: Seat[]
  /** Radius of the last row, so the next level up knows where to start. */
  outerRadius: number
}

/**
 * One curved bank: rows on concentric arcs facing the stage, seats spaced along
 * each arc rather than by a fixed angle — otherwise the back rows would fan out
 * and the front rows would be shoulder to shoulder.
 */
function buildBank(
  wanted: number,
  firstRadius: number,
  baseHeight: number,
  rise: number,
  level: number,
  random: Random,
): Bank {
  const seats: Seat[] = []
  let radius = firstRadius
  let row = 0

  while (seats.length < wanted) {
    radius = firstRadius + row * ROW_DEPTH

    const step = SEAT_PITCH / radius
    const places = Math.floor((2 * HALF_ANGLE) / step)
    const z = baseHeight + row * rise + PHONE_HEIGHT

    for (let place = 0; place <= places; place++) {
      const angle = -HALF_ANGLE + place * step

      // The gangway down the middle, as in the photograph: two blocks of seats
      // and a carpet between them.
      if (Math.abs(angle) < AISLE_HALF_ANGLE) continue

      const point = { x: radius * Math.sin(angle), y: radius * Math.cos(angle), z }

      seats.push(seatAt(point, level, random))
    }

    row++
  }

  return { seats, outerRadius: radius }
}

/**
 * A theatre: curved rows on a gently raked floor, a gangway down the middle, and
 * two balconies stacked above the back of the house.
 *
 * It is the only venue where people stand above other people, and the only one
 * indoors — which makes it the hard case twice over. The balconies reach back
 * over the floor, so two devices metres apart in plan can be six metres apart in
 * height, and a reconstruction that quietly works in two dimensions fails here
 * rather than passing by luck.
 */
export const theater: Venue = {
  description: 'Curved rows facing a stage, a central gangway, and two balconies above.',

  // Indoors. The fix is mostly reflection and dead reckoning by this point, and
  // the height it reports is barely a measurement at all.
  sigma: { horizontal: 15, vertical: 25 },

  build(capacity: number, random: Random): Seat[] {
    const seats: Seat[] = []
    let radius = FIRST_ROW_RADIUS

    for (let level = 0; level < SHARES.length; level++) {
      const wanted = Math.ceil(capacity * (SHARES[level] as number))
      const rise = level === 0 ? STALLS_RISE : BALCONY_RISE

      const bank = buildBank(wanted, radius, BALCONY_HEIGHTS[level] as number, rise, level, random)

      // Spreading would put every seat on the call stack, and a full house is
      // tens of thousands of them.
      for (const seat of bank.seats) seats.push(seat)

      // A balcony reaches back over the level below, but never past the first
      // row of the house — a small crowd would otherwise hang its balcony over
      // the stage.
      radius = Math.max(FIRST_ROW_RADIUS, bank.outerRadius - OVERHANG)
    }

    return seats
  },
}
