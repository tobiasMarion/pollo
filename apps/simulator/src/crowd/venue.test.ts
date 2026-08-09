import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import { occupy } from './occupancy.js'
import { SEAT_PITCH, type Seat } from './seat.js'
import { capacityFor, venueNames, venues } from './venue.js'

/** Small enough that the O(n²) sweep below stays honest and fast. */
const CAPACITY = 1_200

/**
 * Nobody may be closer to their neighbour than this. Not the pitch itself: the
 * jitter is allowed to close some of the gap, which is the point of it.
 */
const CLOSEST_ALLOWED = SEAT_PITCH * 0.7

function closestPair(seats: readonly Seat[]) {
  let closest = Number.POSITIVE_INFINITY

  for (let i = 0; i < seats.length; i++) {
    const a = (seats[i] as Seat).point

    for (let j = i + 1; j < seats.length; j++) {
      const b = (seats[j] as Seat).point
      const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

      if (distance < closest) closest = distance
    }
  }

  return closest
}

describe.each(venueNames)('%s', name => {
  const venue = venues[name]
  const build = (capacity = CAPACITY, seed = 1) => venue.build(capacity, new Random(seed))

  it('seats at least everybody it was asked to', () => {
    expect(build().length).toBeGreaterThanOrEqual(CAPACITY)
  })

  it('grows with the crowd', () => {
    expect(build(4_000).length).toBeGreaterThan(build(400).length)
  })

  it('never stands two people on top of each other', () => {
    expect(closestPair(build())).toBeGreaterThan(CLOSEST_ALLOWED)
  })

  it('places everybody somewhere finite', () => {
    for (const { point } of build()) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
      expect(Number.isFinite(point.z)).toBe(true)
    }
  })

  it('holds the phones off the floor', () => {
    for (const { point } of build()) expect(point.z).toBeGreaterThan(0.5)
  })

  it('replays exactly from the seed', () => {
    expect(build(CAPACITY, 7)).toEqual(build(CAPACITY, 7))
  })

  it('lays out a different crowd for a different seed', () => {
    expect(build(CAPACITY, 7)).not.toEqual(build(CAPACITY, 8))
  })

  it('declares an error budget a phone could plausibly have', () => {
    expect(venue.sigma.horizontal).toBeGreaterThan(0)
    // No fix is better in height than it is on the ground.
    expect(venue.sigma.vertical).toBeGreaterThanOrEqual(venue.sigma.horizontal)
  })

  it('leaves somewhere to move to', () => {
    const clients = 500
    const seats = build(capacityFor(clients))

    expect(seats.length).toBeGreaterThan(clients)
    expect(occupy(seats.length, clients, new Random(3)).length).toBe(clients)
  })
})
