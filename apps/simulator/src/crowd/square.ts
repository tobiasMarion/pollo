import type { Random } from '../noise/random.js'
import { PHONE_HEIGHT, SEAT_PITCH, type Seat, seatAt } from './seat.js'
import type { Venue } from './venue.js'

/**
 * A flat square of standing people, centred on the event origin: a club, a hall,
 * a field. No structure and no relief, which is exactly what makes it the
 * control — every other venue's error can be read against this one.
 */
export const square: Venue = {
  description: 'A flat square of standing people — a club, a hall, an open field.',

  // Open sky, or near enough. This is as good as a phone's fix ever gets.
  sigma: { horizontal: 4, vertical: 8 },

  build(capacity: number, random: Random): Seat[] {
    const side = Math.ceil(Math.sqrt(capacity))
    const half = ((side - 1) * SEAT_PITCH) / 2

    const seats: Seat[] = []

    for (let row = 0; row < side; row++) {
      for (let column = 0; column < side; column++) {
        const point = {
          x: column * SEAT_PITCH - half,
          y: row * SEAT_PITCH - half,
          z: PHONE_HEIGHT,
        }

        seats.push(seatAt(point, 0, random))
      }
    }

    return seats
  },
}
