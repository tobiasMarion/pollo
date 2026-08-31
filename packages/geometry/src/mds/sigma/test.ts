import { describe, expect, it } from 'vitest'
import { Random } from '../../random/index.js'
import { blendScale, estimateScale, MIN_SIGMA, type Sample, sigmaAt } from './index.js'

/**
 * Residuals drawn from a sensor whose sigma really is `floor + relative·d`,
 * spread over a range of distances — which is what the estimator is given and
 * what it has to read back out.
 */
function samplesFrom(floor: number, relative: number, count = 400, seed = 1): Sample[] {
  const random = new Random(seed)

  return Array.from({ length: count }, (_, i) => {
    const distance = 0.5 + (i / count) * 19.5

    return { distance, residual: random.gaussian() * (floor + relative * distance) }
  })
}

describe('sigmaAt', () => {
  it('is a floor plus a share of the distance', () => {
    expect(sigmaAt({ floor: 0.2, relative: 0.08 }, 10)).toBeCloseTo(1, 12)
    expect(sigmaAt({ floor: 0.2, relative: 0.08 }, 0)).toBeCloseTo(0.2, 12)
  })

  it('never returns a sigma small enough to divide by', () => {
    expect(sigmaAt({ floor: 0, relative: 0 }, 5)).toBe(MIN_SIGMA)
    expect(sigmaAt({ floor: -1, relative: 0 }, 0)).toBe(MIN_SIGMA)
  })
})

describe('estimateScale', () => {
  /**
   * What is actually identifiable, which is less than two parameters.
   *
   * The estimate is a line through two robust points, so the *curve* over the
   * distances the samples cover comes out within a fifth of the truth — and that
   * curve is the only thing anything downstream reads, because it is what sets
   * the weights. The floor on its own is an extrapolation back to a distance
   * nobody measured, and it wanders by a factor of two between seeds. Asserting
   * it would be pinning a number the method does not claim to know.
   */
  it('recovers the sigma curve of a sensor it was never told about', () => {
    for (const [floor, relative] of [
      [0.05, 0.02],
      [0.4, 0.1],
      [1.2, 0.25],
    ] as const) {
      for (const seed of [1, 2, 3]) {
        const fitted = estimateScale(samplesFrom(floor, relative, 400, seed))

        expect(fitted).not.toBeNull()
        if (!fitted) continue

        for (const distance of [5, 10, 20]) {
          const ratio = sigmaAt(fitted, distance) / (floor + relative * distance)

          expect(ratio).toBeGreaterThan(0.8)
          expect(ratio).toBeLessThan(1.25)
        }

        expect(fitted.relative).toBeGreaterThan(relative * 0.8)
        expect(fitted.relative).toBeLessThan(relative * 1.3)
      }
    }
  })

  /** Two halves need enough in each half for a median to mean anything. */
  it('says nothing at all below sixteen samples', () => {
    expect(estimateScale(samplesFrom(0.2, 0.08, 15))).toBeNull()
    expect(estimateScale(samplesFrom(0.2, 0.08, 16))).not.toBeNull()
    expect(estimateScale([])).toBeNull()
  })

  /**
   * Every sample at the same distance says nothing about how sigma grows with
   * it. Taking the level and calling the slope flat beats dividing by zero.
   */
  it('assumes a flat slope when every sample is at the same distance', () => {
    const fitted = estimateScale(
      Array.from({ length: 40 }, (_, i) => ({ distance: 3, residual: i % 2 === 0 ? 0.5 : -0.5 })),
    )

    expect(fitted?.relative).toBe(0)
    expect(fitted?.floor).toBeCloseTo(0.5 / 0.674_489_75, 6)
  })

  /**
   * A sigma that shrinks with distance is a fit to noise in the fit. The form is
   * the premise, so a batch that violates it is a batch with nothing to say.
   */
  it('clamps a sensor that appears to get better with distance', () => {
    const fitted = estimateScale(
      Array.from({ length: 40 }, (_, i) => ({
        distance: 1 + i,
        residual: (i < 20 ? 5 : 0.01) * (i % 2 === 0 ? 1 : -1),
      })),
    )

    expect(fitted?.relative).toBe(0)
    expect(fitted?.floor).toBeGreaterThanOrEqual(MIN_SIGMA)
  })

  it('never fits a floor small enough to divide by', () => {
    const fitted = estimateScale(
      Array.from({ length: 40 }, (_, i) => ({
        distance: 1 + i,
        residual: (i < 20 ? 0.001 : 4) * (i % 2 === 0 ? 1 : -1),
      })),
    )

    // The line through the two halves crosses zero well before the origin.
    expect(fitted?.floor).toBe(MIN_SIGMA)
    expect(fitted?.relative).toBeGreaterThan(0)
  })
})

describe('blendScale', () => {
  it('stays put at nought and arrives whole at one', () => {
    const current = { floor: 0.1, relative: 0.05 }
    const next = { floor: 0.5, relative: 0.2 }

    expect(blendScale(current, next, 0)).toEqual(current)
    expect(blendScale(current, next, 1)).toEqual(next)
  })

  it('eases part of the way for anything between', () => {
    const blended = blendScale({ floor: 0, relative: 0 }, { floor: 1, relative: 0.4 }, 0.25)

    expect(blended.floor).toBeCloseTo(0.25, 12)
    expect(blended.relative).toBeCloseTo(0.1, 12)
  })
})
