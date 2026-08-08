import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import { occupy } from './occupancy.js'

describe('occupy', () => {
  it('never seats two people in the same place', () => {
    const taken = occupy(5_000, 900, new Random(1))

    expect(taken.length).toBe(900)
    expect(new Set(taken).size).toBe(900)
  })

  it('stays inside the venue', () => {
    for (const seat of occupy(200, 200, new Random(2))) {
      expect(seat).toBeGreaterThanOrEqual(0)
      expect(seat).toBeLessThan(200)
    }
  })

  it('replays from the seed', () => {
    expect(occupy(1_000, 100, new Random(3))).toEqual(occupy(1_000, 100, new Random(3)))
    expect(occupy(1_000, 100, new Random(3))).not.toEqual(occupy(1_000, 100, new Random(4)))
  })

  it('spreads the crowd through the venue rather than filling the front', () => {
    const taken = occupy(10_000, 1_000, new Random(5))
    const mean = taken.reduce((sum, seat) => sum + seat, 0) / taken.length

    // The mean seat index of a uniform draw sits near the middle of the plan.
    expect(mean).toBeGreaterThan(4_000)
    expect(mean).toBeLessThan(6_000)
  })

  it('refuses a crowd the venue cannot hold', () => {
    expect(() => occupy(100, 101, new Random(6))).toThrow(/100 seats/)
  })
})
