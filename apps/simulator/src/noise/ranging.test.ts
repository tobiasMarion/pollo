import { describe, expect, it } from 'vitest'
import { Random } from './random.js'
import { Ranging } from './ranging.js'

const RANGE = 6

function measureMany(trueDistance: number, count: number, seed = 1) {
  const ranging = new Ranging(new Random(seed), RANGE)
  const heard: number[] = []
  let silent = 0

  for (let i = 0; i < count; i++) {
    const measured = ranging.measure(trueDistance)

    if (measured === null) silent++
    else heard.push(measured)
  }

  return { heard, silent, rate: heard.length / count }
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

describe('Ranging', () => {
  it('measures the distance it was given, on average', () => {
    for (const distance of [0.5, 2, 4]) {
      const { heard } = measureMany(distance, 40_000)

      expect(mean(heard)).toBeCloseTo(distance, 1)
    }
  })

  it('gets a metre wrong in proportion to how many metres there are', () => {
    const spread = (distance: number) => {
      const { heard } = measureMany(distance, 40_000)
      const average = mean(heard)

      return Math.sqrt(mean(heard.map(value => (value - average) ** 2)))
    }

    expect(spread(4)).toBeGreaterThan(spread(1) * 2)
  })

  it('hears a peer standing next to it, and mostly misses one at the limit', () => {
    expect(measureMany(0.2, 20_000).rate).toBeGreaterThan(0.9)
    expect(measureMany(RANGE, 20_000).rate).toBeLessThan(0.2)
  })

  it('hears less the further away the peer is', () => {
    const near = measureMany(1, 20_000).rate
    const middle = measureMany(3, 20_000).rate
    const far = measureMany(5, 20_000).rate

    expect(near).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(far)
  })

  it('says nothing at all about a peer out of range', () => {
    const ranging = new Ranging(new Random(2), RANGE)

    for (let i = 0; i < 1_000; i++) expect(ranging.measure(RANGE + 0.01)).toBeNull()
  })

  it('drops the long tail rather than squashing it against the limit', () => {
    const { heard } = measureMany(5, 40_000)

    // Nothing piles up at the cap: a censored measurement is absent, not maximal.
    expect(Math.max(...heard)).toBeLessThanOrEqual(RANGE * 1.5)
    expect(heard.filter(value => value > RANGE * 1.4).length / heard.length).toBeLessThan(0.02)
  })

  it('never reports a distance a receiver could not', () => {
    const { heard } = measureMany(0.05, 40_000)

    for (const value of heard) expect(value).toBeGreaterThan(0)
  })

  it('replays from the seed', () => {
    expect(measureMany(3, 500, 9).heard).toEqual(measureMany(3, 500, 9).heard)
    expect(measureMany(3, 500, 9).heard).not.toEqual(measureMany(3, 500, 10).heard)
  })
})
