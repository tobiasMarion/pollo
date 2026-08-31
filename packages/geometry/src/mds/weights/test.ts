import { describe, expect, it } from 'vitest'
import { sigmaAt } from '../sigma/index.js'
import { anchorWeights, edgeWeight, robustFactor } from './index.js'

const scale = { floor: 0.2, relative: 0.08 }

describe('edgeWeight', () => {
  /** One over variance is what makes the fit maximum likelihood rather than an average. */
  it('is exactly one over the square of the sigma at that distance', () => {
    for (const distance of [0, 1, 7.5, 40]) {
      const sigma = sigmaAt(scale, distance)

      expect(edgeWeight(distance, scale)).toBeCloseTo(1 / (sigma * sigma), 12)
    }
  })

  it('makes a measurement three times as uncertain pull a ninth as hard', () => {
    const tight = { floor: 1, relative: 0 }
    const loose = { floor: 3, relative: 0 }

    expect(edgeWeight(5, loose) / edgeWeight(5, tight)).toBeCloseTo(1 / 9, 12)
  })
})

describe('robustFactor', () => {
  it('counts a residual inside the knee in full', () => {
    expect(robustFactor(0, 0.5, 2)).toBe(1)
    expect(robustFactor(0.5, 0.5, 2)).toBe(1)
    expect(robustFactor(1, 0.5, 2)).toBe(1)
  })

  /** Huber bends; it does not step. A jump here would be a discontinuous objective. */
  it('is continuous where it bends', () => {
    const justInside = robustFactor(2 - 1e-9, 1, 2)
    const justOutside = robustFactor(2 + 1e-9, 1, 2)

    expect(justInside).toBe(1)
    expect(Math.abs(justOutside - justInside)).toBeLessThan(1e-8)
  })

  it('falls away past the knee and never counts anything more than in full', () => {
    let previous = 1

    for (const residual of [2.5, 4, 8, 20, 100]) {
      const factor = robustFactor(residual, 1, 2)

      expect(factor).toBeLessThan(previous)
      expect(factor).toBeLessThanOrEqual(1)
      previous = factor
    }
  })

  it('does not care which side of the measurement the residual fell on', () => {
    expect(robustFactor(-7, 1.5, 2)).toBe(robustFactor(7, 1.5, 2))
  })

  it('is plain least squares when the knee is put out of reach', () => {
    expect(robustFactor(1e6, 1, Number.POSITIVE_INFINITY)).toBe(1)
  })

  /** The knee is in sigmas, so it follows the sensor rather than the venue. */
  it('bends at the same number of sigmas whatever the sensor', () => {
    expect(robustFactor(6, 3, 2)).toBe(robustFactor(0.6, 0.3, 2))
  })
})

describe('anchorWeights', () => {
  it('is one over variance, per axis, from what the device claimed', () => {
    const weights = anchorWeights(4, 10, 1)

    expect(weights.horizontal).toBeCloseTo(1 / 16, 12)
    expect(weights.vertical).toBeCloseTo(1 / 100, 12)
  })

  /**
   * A fix good to five metres across the ground is routinely twelve metres out
   * in height. Collapsing the two would either throw away good horizontal
   * information or believe bad vertical information.
   */
  it('keeps the two axes apart', () => {
    const weights = anchorWeights(1, 100, 1)

    expect(weights.horizontal / weights.vertical).toBeCloseTo(10_000, 6)
  })

  it('refuses to believe an accuracy better than ten centimetres', () => {
    expect(anchorWeights(0, 0, 1)).toEqual(anchorWeights(0.1, 0.1, 1))
    expect(anchorWeights(0.01, 0.05, 1)).toEqual(anchorWeights(0.1, 0.1, 1))
  })

  it('scales both axes by the global trust in the reading', () => {
    const trusted = anchorWeights(4, 10, 1)
    const halved = anchorWeights(4, 10, 0.5)

    expect(halved.horizontal).toBeCloseTo(trusted.horizontal / 2, 12)
    expect(halved.vertical).toBeCloseTo(trusted.vertical / 2, 12)
  })
})
