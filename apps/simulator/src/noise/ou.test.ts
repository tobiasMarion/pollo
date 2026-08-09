import { describe, expect, it } from 'vitest'
import { LayeredOu, OrnsteinUhlenbeck, stationarySigma, Vector3Ou } from './ou.js'
import { Random } from './random.js'

function run(step: (dt: number) => number, count: number, dt: number) {
  const values: number[] = []
  for (let i = 0; i < count; i++) values.push(step(dt))
  return values
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[]) {
  const average = mean(values)
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)))
}

/** Correlation between the series and itself shifted by `lag` samples. */
function autocorrelation(values: readonly number[], lag: number) {
  const average = mean(values)
  let covariance = 0
  let variance = 0

  for (let i = 0; i < values.length - lag; i++) {
    covariance += ((values[i] ?? 0) - average) * ((values[i + lag] ?? 0) - average)
  }

  for (const value of values) variance += (value - average) ** 2

  return covariance / variance
}

describe('OrnsteinUhlenbeck', () => {
  it('holds the stationary sigma it was given', () => {
    const process = new OrnsteinUhlenbeck({ tau: 20, sigma: 6 }, new Random(1))
    const values = run(dt => process.step(dt), 200_000, 1)

    expect(mean(values)).toBeCloseTo(0, 0)
    expect(standardDeviation(values)).toBeCloseTo(6, 0)
  })

  it('holds that sigma regardless of the step size', () => {
    const coarse = new OrnsteinUhlenbeck({ tau: 20, sigma: 6 }, new Random(2))
    const fine = new OrnsteinUhlenbeck({ tau: 20, sigma: 6 }, new Random(3))

    const coarseSigma = standardDeviation(run(dt => coarse.step(dt), 100_000, 4))
    const fineSigma = standardDeviation(run(dt => fine.step(dt), 100_000, 0.1))

    expect(coarseSigma).toBeCloseTo(6, 0)
    expect(fineSigma).toBeCloseTo(6, 0)
  })

  it('decays its autocorrelation as exp(-lag/tau)', () => {
    const tau = 30
    const process = new OrnsteinUhlenbeck({ tau, sigma: 5 }, new Random(4))
    const values = run(dt => process.step(dt), 200_000, 1)

    expect(autocorrelation(values, 1)).toBeCloseTo(Math.exp(-1 / tau), 1)
    expect(autocorrelation(values, 30)).toBeCloseTo(Math.exp(-1), 1)
    expect(autocorrelation(values, 120)).toBeCloseTo(Math.exp(-4), 1)
  })

  it('stays bounded where a random walk would run away', () => {
    const process = new OrnsteinUhlenbeck({ tau: 15, sigma: 5 }, new Random(5))
    const values = run(dt => process.step(dt), 100_000, 1)

    const worst = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0)

    expect(worst).toBeLessThan(5 * 6)
  })

  it('starts from the stationary distribution rather than at zero', () => {
    const starts = Array.from(
      { length: 5_000 },
      (_, index) => new OrnsteinUhlenbeck({ tau: 20, sigma: 4 }, new Random(index)).value,
    )

    expect(standardDeviation(starts)).toBeCloseTo(4, 0)
  })
})

describe('LayeredOu', () => {
  const layers = [
    { tau: 15, sigma: 3 },
    { tau: 400, sigma: 4 },
  ]

  it('adds its layers in variance', () => {
    const process = new LayeredOu(layers, new Random(6))
    const values = run(dt => process.step(dt), 300_000, 1)

    expect(standardDeviation(values)).toBeCloseTo(stationarySigma(layers), 0)
    expect(stationarySigma(layers)).toBeCloseTo(5, 6)
  })

  it('keeps more memory at long lags than a single fast layer would', () => {
    const layered = new LayeredOu(layers, new Random(7))
    const fastOnly = new OrnsteinUhlenbeck({ tau: 15, sigma: 5 }, new Random(8))

    const layeredValues = run(dt => layered.step(dt), 200_000, 1)
    const fastValues = run(dt => fastOnly.step(dt), 200_000, 1)

    expect(autocorrelation(layeredValues, 200)).toBeGreaterThan(
      autocorrelation(fastValues, 200) + 0.2,
    )
  })
})

describe('Vector3Ou', () => {
  it('gives the vertical axis its own layers', () => {
    const process = new Vector3Ou([{ tau: 20, sigma: 4 }], [{ tau: 60, sigma: 11 }], new Random(9))

    const xs: number[] = []
    const zs: number[] = []

    for (let i = 0; i < 200_000; i++) {
      const value = process.step(1)
      xs.push(value.x)
      zs.push(value.z)
    }

    expect(standardDeviation(xs)).toBeCloseTo(4, 0)
    expect(standardDeviation(zs)).toBeCloseTo(11, 0)
  })

  it('drives its axes independently', () => {
    const process = new Vector3Ou([{ tau: 20, sigma: 5 }], [{ tau: 20, sigma: 5 }], new Random(10))

    const xs: number[] = []
    const ys: number[] = []

    for (let i = 0; i < 100_000; i++) {
      const value = process.step(1)
      xs.push(value.x)
      ys.push(value.y)
    }

    const averageX = mean(xs)
    const averageY = mean(ys)
    let covariance = 0

    for (let i = 0; i < xs.length; i++) {
      covariance += ((xs[i] ?? 0) - averageX) * ((ys[i] ?? 0) - averageY)
    }

    const correlation = covariance / xs.length / (standardDeviation(xs) * standardDeviation(ys))

    expect(Math.abs(correlation)).toBeLessThan(0.05)
  })
})
