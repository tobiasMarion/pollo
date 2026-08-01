import { describe, expect, it } from 'vitest'
import { deriveSeed, Random } from './random.js'

function sample(count: number, draw: () => number) {
  const values: number[] = []
  for (let i = 0; i < count; i++) values.push(draw())
  return values
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[]) {
  const average = mean(values)
  const variance = mean(values.map(value => (value - average) ** 2))
  return Math.sqrt(variance)
}

// `Math.min(...values)` spreads every sample onto the call stack, and these
// suites draw hundreds of thousands of them.
function smallest(values: readonly number[]) {
  return values.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY)
}

function largest(values: readonly number[]) {
  return values.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY)
}

describe('Random', () => {
  it('replays the same stream for the same seed', () => {
    const first = sample(1_000, () => new Random(42).float())
    const second = sample(1_000, () => new Random(42).float())

    expect(first).toEqual(second)
  })

  it('diverges for neighbouring seeds', () => {
    expect(new Random(1).float()).not.toBe(new Random(2).float())
  })

  it('draws uniforms inside [0, 1)', () => {
    const random = new Random(7)
    const values = sample(100_000, () => random.float())

    expect(smallest(values)).toBeGreaterThanOrEqual(0)
    expect(largest(values)).toBeLessThan(1)
    expect(mean(values)).toBeCloseTo(0.5, 2)
  })

  it('draws a standard normal', () => {
    const random = new Random(11)
    const values = sample(200_000, () => random.gaussian())

    expect(mean(values)).toBeCloseTo(0, 1)
    expect(standardDeviation(values)).toBeCloseTo(1, 1)
  })

  it('draws exponentials with the requested mean', () => {
    const random = new Random(13)
    const values = sample(200_000, () => random.exponential(8))

    expect(mean(values)).toBeCloseTo(8, 0)
    expect(smallest(values)).toBeGreaterThanOrEqual(0)
  })

  it('draws gammas with the requested mean, and never a negative one', () => {
    const random = new Random(17)
    const values = sample(100_000, () => random.gamma(2.5, 4))

    // Mean of a gamma is shape * scale.
    expect(mean(values)).toBeCloseTo(10, 0)
    expect(smallest(values)).toBeGreaterThan(0)
  })

  it('draws gammas with shape below one', () => {
    const random = new Random(19)
    const values = sample(50_000, () => random.gamma(0.5, 2))

    expect(mean(values)).toBeCloseTo(1, 0)
    expect(values.every(value => value > 0)).toBe(true)
  })

  it('draws unit vectors on the sphere, without clustering on an axis', () => {
    const random = new Random(23)
    const vectors = sample(20_000, () => 0).map(() => random.unitVector())

    for (const vector of vectors) {
      const length = Math.hypot(vector.x, vector.y, vector.z)
      expect(length).toBeCloseTo(1, 10)
    }

    expect(mean(vectors.map(vector => vector.z))).toBeCloseTo(0, 1)
    expect(standardDeviation(vectors.map(vector => vector.z))).toBeCloseTo(1 / Math.sqrt(3), 1)
  })
})

describe('deriveSeed', () => {
  it('gives neighbouring indices unrelated streams', () => {
    const first = new Random(deriveSeed(99, 0)).float()
    const second = new Random(deriveSeed(99, 1)).float()

    expect(Math.abs(first - second)).toBeGreaterThan(0.01)
  })

  it('depends on the run seed as well as the index', () => {
    expect(deriveSeed(1, 5)).not.toBe(deriveSeed(2, 5))
  })

  it('is stable across calls', () => {
    expect(deriveSeed(1234, 77)).toBe(deriveSeed(1234, 77))
  })
})
