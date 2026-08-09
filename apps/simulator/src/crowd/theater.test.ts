import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import type { Seat } from './seat.js'
import { AISLE_HALF_ANGLE, HALF_ANGLE, theater } from './theater.js'

const CAPACITY = 3_000

/** Room for the jitter, which is allowed to nudge a seat over any line. */
const SLACK = 0.02

/** Where a seat sits relative to the axis of the stage. */
function bearing({ point }: Seat) {
  return Math.atan2(point.x, point.y)
}

function radius({ point }: Seat) {
  return Math.hypot(point.x, point.y)
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

describe('theater', () => {
  const seats = theater.build(CAPACITY, new Random(1))
  const level = (index: number) => seats.filter(seat => seat.level === index)

  it('stacks the house on three levels', () => {
    expect(new Set(seats.map(seat => seat.level))).toEqual(new Set([0, 1, 2]))
  })

  it('puts everybody in front of the stage', () => {
    for (const seat of seats) {
      expect(seat.point.y).toBeGreaterThan(0)
      expect(Math.abs(bearing(seat))).toBeLessThanOrEqual(HALF_ANGLE + SLACK)
    }
  })

  it('keeps the central gangway clear', () => {
    for (const seat of seats) {
      expect(Math.abs(bearing(seat))).toBeGreaterThan(AISLE_HALF_ANGLE - SLACK)
    }
  })

  it('lifts each balcony clear of the level below it', () => {
    const highest = (index: number) => Math.max(...level(index).map(seat => seat.point.z))
    const lowest = (index: number) => Math.min(...level(index).map(seat => seat.point.z))

    expect(lowest(1)).toBeGreaterThan(highest(0))
    expect(lowest(2)).toBeGreaterThan(highest(1))
  })

  it('keeps the balconies clear however big the house gets', () => {
    // The stalls rake back and up with the crowd. Balconies pinned to a fixed
    // height end up buried inside the bank they are meant to overhang, and past
    // ten thousand people they did.
    for (const capacity of [3_000, 30_000, 120_000]) {
      const house = theater.build(capacity, new Random(2))

      const bands = [0, 1, 2].map(index => {
        const bank = house.filter(seat => seat.level === index)

        return {
          low: Math.min(...bank.map(seat => seat.point.z)),
          high: Math.max(...bank.map(seat => seat.point.z)),
        }
      })

      expect(bands[1]?.low).toBeGreaterThan(bands[0]?.high as number)
      expect(bands[2]?.low).toBeGreaterThan(bands[1]?.high as number)
    }
  })

  it('sets the balconies back over the rear of the house', () => {
    expect(average(level(1).map(radius))).toBeGreaterThan(average(level(0).map(radius)))
    expect(average(level(2).map(radius))).toBeGreaterThan(average(level(1).map(radius)))
  })

  it('hangs a balcony over the floor rather than behind it', () => {
    // The overhang is what makes this venue worth having: two devices metres
    // apart on the plan, and six metres apart in height.
    const balconyFront = Math.min(...level(1).map(radius))
    const floorBack = Math.max(...level(0).map(radius))

    expect(balconyFront).toBeLessThan(floorBack)
  })

  it('rakes the balconies harder than the floor', () => {
    const rake = (index: number) => {
      const bank = level(index)
      const heights = [...new Set(bank.map(seat => Math.round(seat.point.z * 100) / 100))].sort(
        (a, b) => a - b,
      )

      return (heights[heights.length - 1] as number) - (heights[0] as number)
    }

    expect(rake(1) / level(1).length).toBeGreaterThan(rake(0) / level(0).length)
  })

  it('seats the floor of the house more densely than the balconies', () => {
    expect(level(0).length).toBeGreaterThan(level(1).length)
    expect(level(1).length).toBeGreaterThan(level(2).length)
  })
})
