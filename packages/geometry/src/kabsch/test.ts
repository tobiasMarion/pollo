import { describe, expect, it } from 'vitest'
import { Random } from '../random/index.js'
import { distance, type Vector3 } from '../vector/index.js'
import { alignClouds, applyAlignment, IDENTITY_ALIGNMENT, rotate } from './index.js'

function cloud(count: number, random: Random) {
  const points = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    points[i * 3] = random.between(-60, 60)
    points[i * 3 + 1] = random.between(-40, 40)
    points[i * 3 + 2] = random.between(0, 25)
  }

  return points
}

function transformed(points: Float32Array, count: number, turn: (point: Vector3) => Vector3) {
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

  return (point: Vector3): Vector3 => ({
    x: cos * point.x - sin * point.y,
    y: sin * point.x + cos * point.y,
    z: point.z,
  })
}

function pointAt(points: Float32Array, index: number): Vector3 {
  return {
    x: points[index * 3] ?? 0,
    y: points[index * 3 + 1] ?? 0,
    z: points[index * 3 + 2] ?? 0,
  }
}

/** Root mean square distance between the two clouds once `from` has been moved. */
function residual(from: Float32Array, to: Float32Array, count: number) {
  const alignment = alignClouds(from, to, count)

  let total = 0

  for (let i = 0; i < count; i++) {
    total += distance(applyAlignment(alignment, pointAt(from, i)), pointAt(to, i)) ** 2
  }

  return Math.sqrt(total / count)
}

const count = 500
const truth = cloud(count, new Random(1))

describe('alignClouds', () => {
  it('recovers a rotation, a translation, and the two together', () => {
    expect(residual(transformed(truth, count, aroundZ(0.7)), truth, count)).toBeLessThan(1e-3)

    const shifted = transformed(truth, count, point => ({
      x: point.x + 120,
      y: point.y - 45,
      z: point.z + 8,
    }))

    expect(residual(shifted, truth, count)).toBeLessThan(1e-3)

    const both = transformed(truth, count, point => {
      const turned = aroundZ(2.1)(point)

      return { x: turned.x + 30, y: turned.y + 90, z: turned.z - 12 }
    })

    expect(residual(both, truth, count)).toBeLessThan(1e-3)
  })

  /**
   * A reflection is not a rigid motion. If the fit were allowed to take one, a
   * solver that flipped the crowd would be scored as perfect — and a
   * reconstruction from distances alone is exactly the thing that can flip.
   */
  it('refuses to accept a mirror image as a fit', () => {
    const mirrored = transformed(truth, count, point => ({
      x: -point.x,
      y: point.y,
      z: point.z,
    }))

    expect(residual(mirrored, truth, count)).toBeGreaterThan(10)
  })

  it('leaves a genuinely deformed cloud looking wrong', () => {
    const random = new Random(2)
    const noisy = new Float32Array(truth)

    for (let i = 0; i < count * 3; i++) noisy[i] = (noisy[i] ?? 0) + random.gaussian() * 3

    const scored = residual(noisy, truth, count)

    expect(scored).toBeGreaterThan(4)
    expect(scored).toBeLessThan(6)
  })

  /** The best rigid motion is never worse than no motion at all. */
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

      let unaligned = 0

      for (let i = 0; i < count; i++) {
        unaligned += distance(pointAt(estimate, i), pointAt(truth, i)) ** 2
      }

      expect(residual(estimate, truth, count)).toBeLessThanOrEqual(
        Math.sqrt(unaligned / count) + 1e-6,
      )
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

    expect(applyAlignment(alignment, { x: 5, y: 0, z: 0 }).x).toBeCloseTo(5, 6)
  })

  it('returns the identity for fewer than three points', () => {
    const two = new Float32Array([0, 0, 0, 1, 1, 1])

    expect(alignClouds(two, two, 2)).toBe(IDENTITY_ALIGNMENT)
    expect(applyAlignment(IDENTITY_ALIGNMENT, { x: 3, y: 4, z: 5 })).toEqual({ x: 3, y: 4, z: 5 })
  })

  /**
   * A cloud that is nearly flat is the ordinary case, not the awkward one: every
   * venue is far wider than it is tall. The smallest singular value is near zero
   * there, and the fit still has to come out orthonormal.
   */
  it('fits a crowd standing on a floor', () => {
    const random = new Random(5)
    const flat = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      flat[i * 3] = random.between(-60, 60)
      flat[i * 3 + 1] = random.between(-40, 40)
      flat[i * 3 + 2] = random.gaussian() * 0.001
    }

    const turned = transformed(flat, count, aroundZ(1.1))

    expect(residual(turned, flat, count)).toBeLessThan(1e-2)
  })
})

describe('rotate', () => {
  it('turns a point by a quarter circle around z', () => {
    const quarter = Float64Array.from([0, -1, 0, 1, 0, 0, 0, 0, 1])
    const turned = rotate(quarter, { x: 2, y: 0, z: 5 })

    expect(turned.x).toBeCloseTo(0, 12)
    expect(turned.y).toBeCloseTo(2, 12)
    expect(turned.z).toBeCloseTo(5, 12)
  })
})
