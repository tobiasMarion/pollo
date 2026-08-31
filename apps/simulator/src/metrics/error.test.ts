import { Random } from '@pollo/geometry'
import { describe, expect, it } from 'vitest'
import { compareClouds } from './error.js'

function cloud(count: number, random: Random) {
  const points = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    points[i * 3] = random.between(-60, 60)
    points[i * 3 + 1] = random.between(-40, 40)
    points[i * 3 + 2] = random.between(0, 25)
  }

  return points
}

function turnedAroundZ(points: Float32Array, count: number, angle: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const out = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const x = points[i * 3] ?? 0
    const y = points[i * 3 + 1] ?? 0

    out[i * 3] = cos * x - sin * y
    out[i * 3 + 1] = sin * x + cos * y
    out[i * 3 + 2] = points[i * 3 + 2] ?? 0
  }

  return out
}

const count = 500
const truth = cloud(count, new Random(1))

describe('compareClouds', () => {
  it('summarises an exact match as zero', () => {
    const comparison = compareClouds(truth, truth, count)

    expect(comparison.raw.mean).toBeCloseTo(0, 6)
    expect(comparison.raw.max).toBeCloseTo(0, 6)
    expect(comparison.raw.count).toBe(count)
  })

  it('orders its percentiles', () => {
    const random = new Random(4)
    const noisy = new Float32Array(truth)

    for (let i = 0; i < count * 3; i++) noisy[i] = (noisy[i] ?? 0) + random.gaussian() * 5

    const { raw } = compareClouds(noisy, truth, count)

    expect(raw.p50).toBeLessThanOrEqual(raw.p95)
    expect(raw.p95).toBeLessThanOrEqual(raw.max)
    expect(raw.rmse).toBeGreaterThanOrEqual(raw.mean)
  })

  /**
   * The gap between the two summaries is the whole reason there are two: a
   * reconstruction that got the shape right and the compass wrong should read as
   * badly placed and well shaped, not as one number that hides both.
   */
  it('separates a rigid misalignment from a bad shape', () => {
    const turned = compareClouds(turnedAroundZ(truth, count, 0.7), truth, count)

    expect(turned.raw.rmse).toBeGreaterThan(10)
    expect(turned.aligned.rmse).toBeLessThan(1e-3)

    const random = new Random(2)
    const noisy = new Float32Array(truth)

    for (let i = 0; i < count * 3; i++) noisy[i] = (noisy[i] ?? 0) + random.gaussian() * 3

    const deformed = compareClouds(noisy, truth, count)

    expect(deformed.aligned.rmse).toBeGreaterThan(4)
    expect(deformed.aligned.rmse).toBeLessThan(6)
  })

  it('says nothing when it has been told nothing', () => {
    const comparison = compareClouds(new Float32Array(0), new Float32Array(0), 0)

    expect(comparison.raw.count).toBe(0)
    expect(comparison.aligned.rmse).toBe(0)
  })
})
