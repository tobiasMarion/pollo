import type { Random } from '../noise/random.js'
import type { Seat } from './seat.js'
import { square } from './square.js'
import { stands } from './stands.js'
import { theater } from './theater.js'

export interface Venue {
  /** One line, printed by `--help` next to the name. */
  description: string
  /**
   * How badly a fix behaves here, in meters — one constant for the whole place.
   *
   * Not derived from geometry, and deliberately so. What a phone can see of the
   * sky depends on the roof, the balcony overhead, the body in front of it and
   * the building next door, none of which the simulator knows and none of which
   * a venue file could honestly guess. What it can say is the thing that
   * actually differs between a field and a theatre: roughly how wrong a fix is
   * in this kind of room.
   */
  sigma: { horizontal: number; vertical: number }
  /** Lays out at least `capacity` seats, sized to fit them. */
  build(capacity: number, random: Random): Seat[]
}

/**
 * The three places, as a record: the `--venue` values, the help text and the
 * type all derive from these keys, in the spirit of `packages/contracts`.
 */
export const venues = { square, stands, theater } as const satisfies Record<string, Venue>

export type VenueName = keyof typeof venues

export const venueNames = Object.keys(venues) as [VenueName, ...VenueName[]]

/**
 * Empty seats the layout carries beyond the crowd itself. People move during an
 * event, and somebody who moves needs an empty seat to move into — a venue built
 * to exactly `--clients` is a venue where nobody can ever get up.
 */
const SPARE_SHARE = 0.1

export function capacityFor(clients: number) {
  return Math.ceil(clients * (1 + SPARE_SHARE)) + 1
}
