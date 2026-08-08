import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import { alignClouds, applyAlignment } from './align.js'
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

function transformed(
  points: Float32Array,
  count: number,
  turn: (point: { x: number; y: number; z: number }) => { x: number; y: number; z: number },
) {
  const out = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const moved = turn({
      x: points[i * 3] ?? 0,
      y: points[i * 3 + 1] ?? 0,
      z: points[i * 3 + 2] ?? 0,
    })

    out[i * 3] = moved.x
    out[i * 3 + 1] = moved.y
    out[i * 3 + 2] = moved.z
  }

  return out
}

function aroundZ(angle: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return (point: { x: number; y: number; z: number }) => ({
    x: cos * point.x - sin * point.y,
    y: sin * point.x + cos * point.y,
    z: point.z,
  })
}

const count = 500
const truth = cloud(count, new Random(1))

describe('alignClouds', () => {
  it('undoes a pure rotation', () => {
    const turned = transformed(truth, count, aroundZ(0.7))
    const comparison = compareClouds(turned, truth, count)

    expect(comparison.raw.rmse).toBeGreaterThan(10)
    expect(comparison.aligned.rmse).toBeLessThan(1e-3)
  })

  it('undoes a pure translation', () => {
    const shifted = transformed(truth, count, point => ({
      x: point.x + 120,
      y: point.y - 45,
      z: point.z + 8,
    }))

    const comparison = compareClouds(shifted, truth, count)

    expect(comparison.raw.rmse).toBeGreaterThan(100)
    expect(comparison.aligned.rmse).toBeLessThan(1e-3)
  })

  it('undoes a rotation and a translation together', () => {
    const moved = transformed(truth, count, point => {
      const turned = aroundZ(2.1)(point)
      return { x: turned.x + 30, y: turned.y + 90, z: turned.z - 12 }
    })

    const comparison = compareClouds(moved, truth, count)

    expect(comparison.aligned.rmse).toBeLessThan(1e-3)
  })

  it('refuses to accept a mirror image as a fit', () => {
    const mirrored = transformed(truth, count, point => ({
      x: -point.x,
      y: point.y,
      z: point.z,
    }))

    const comparison = compareClouds(mirrored, truth, count)

    // A reflection is not a rigid motion. The aligned error must stay large,
    // or a solver that flipped the crowd would be scored as perfect.
    expect(comparison.aligned.rmse).toBeGreaterThan(10)
  })

  it('leaves a genuinely deformed cloud looking wrong', () => {
    const random = new Random(2)
    const noisy = new Float32Array(truth)

    for (let i = 0; i < count * 3; i++) {
      noisy[i] = (noisy[i] ?? 0) + random.gaussian() * 3
    }

    const comparison = compareClouds(noisy, truth, count)

    expect(comparison.aligned.rmse).toBeGreaterThan(4)
    expect(comparison.aligned.rmse).toBeLessThan(6)
  })

  it('never makes the error worse than leaving it alone', () => {
    const random = new Random(3)

    for (let trial = 0; trial < 20; trial++) {
      const estimate = transformed(truth, count, point => {
        const turned = aroundZ(random.between(0, Math.PI * 2))(point)
        return {
          x: turned.x + random.between(-50, 50) + random.gaussian(),
          y: turned.y + random.between(-50, 50) + random.gaussian(),
          z: turned.z + random.gaussian(),
        }
      })

      const comparison = compareClouds(estimate, truth, count)

      expect(comparison.aligned.rmse).toBeLessThanOrEqual(comparison.raw.rmse + 1e-6)
    }
  })

  it('produces an orthonormal rotation', () => {
    const moved = transformed(truth, count, aroundZ(1.3))
    const { rotation } = alignClouds(moved, truth, count)

    for (let row = 0; row < 3; row++) {
      let norm = 0
      for (let column = 0; column < 3; column++) norm += (rotation[row * 3 + column] ?? 0) ** 2
      expect(norm).toBeCloseTo(1, 8)
    }
  })

  it('declines to invent a rotation for a degenerate cloud', () => {
    const line = new Float32Array(9)
    for (let i = 0; i < 3; i++) line[i * 3] = i

    const alignment = alignClouds(line, line, 3)
    const point = { x: 5, y: 0, z: 0 }

    expect(applyAlignment(alignment, point).x).toBeCloseTo(5, 6)
  })

  it('returns the identity for fewer than three points', () => {
    const two = new Float32Array([0, 0, 0, 1, 1, 1])
    const alignment = alignClouds(two, two, 2)

    expect(applyAlignment(alignment, { x: 3, y: 4, z: 5 })).toEqual({ x: 3, y: 4, z: 5 })
  })
})

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

  it('says nothing when it has been told nothing', () => {
    const comparison = compareClouds(new Float32Array(0), new Float32Array(0), 0)

    expect(comparison.raw.count).toBe(0)
    expect(comparison.aligned.rmse).toBe(0)
  })
})
