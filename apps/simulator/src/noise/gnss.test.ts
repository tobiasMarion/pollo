import { describe, expect, it } from 'vitest'
import { DeviceGnss, type ErrorBudget, FIELD_TICK_SECONDS, SharedErrorField } from './gnss.js'
import { deriveSeed, Random } from './random.js'

const BUDGET: ErrorBudget = { horizontal: 6, vertical: 12 }

/** Long enough for the slowest layer (τ = 1200 s) to turn over many times. */
const SAMPLES = 40_000
const DT = 1

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[]) {
  const average = mean(values)
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)))
}

function correlation(left: readonly number[], right: readonly number[]) {
  const leftMean = mean(left)
  const rightMean = mean(right)

  let covariance = 0
  for (let i = 0; i < left.length; i++) {
    covariance += ((left[i] ?? 0) - leftMean) * ((right[i] ?? 0) - rightMean)
  }

  return covariance / left.length / (standardDeviation(left) * standardDeviation(right))
}

/** Runs a crowd of devices through one shared field and keeps their x offsets. */
function run(count: number, share: number, seed = 1, samples = SAMPLES) {
  const field = new SharedErrorField(new Random(deriveSeed(seed, 0)))

  const devices = Array.from(
    { length: count },
    (_, index) => new DeviceGnss(BUDGET, new Random(deriveSeed(seed, index + 1)), share),
  )

  const tracks: number[][] = devices.map(() => [])
  const verticals: number[][] = devices.map(() => [])

  for (let step = 1; step <= samples; step++) {
    field.advanceTo(Math.floor((step * DT) / FIELD_TICK_SECONDS))

    for (let index = 0; index < devices.length; index++) {
      const reading = (devices[index] as DeviceGnss).sample(field, DT)

      ;(tracks[index] as number[]).push(reading.offset.x)
      ;(verticals[index] as number[]).push(reading.offset.z)
    }
  }

  return { tracks, verticals }
}

describe('DeviceGnss', () => {
  it('errs by about as much as the venue says it will', () => {
    const { tracks, verticals } = run(6, 0.8)

    const horizontal = mean(tracks.map(standardDeviation))
    const vertical = mean(verticals.map(standardDeviation))

    // Handsets vary in quality around the budget, so this is a band, not a point.
    expect(horizontal / BUDGET.horizontal).toBeGreaterThan(0.8)
    expect(horizontal / BUDGET.horizontal).toBeLessThan(1.25)
    expect(vertical / BUDGET.vertical).toBeGreaterThan(0.8)
    expect(vertical / BUDGET.vertical).toBeLessThan(1.25)
  })

  it('wanders around the truth rather than away from it', () => {
    const { tracks } = run(4, 0.8)

    for (const track of tracks) expect(Math.abs(mean(track))).toBeLessThan(BUDGET.horizontal)
  })

  it('gets it wrong with the rest of the crowd', () => {
    const [first, second] = run(2, 0.8).tracks

    expect(correlation(first as number[], second as number[])).toBeGreaterThan(0.5)
  })

  it('and drifts alone when told the crowd shares nothing', () => {
    const [first, second] = run(2, 0).tracks

    expect(Math.abs(correlation(first as number[], second as number[]))).toBeLessThan(0.1)
  })

  it('reports an accuracy, and then misses it often enough to matter', () => {
    const field = new SharedErrorField(new Random(1))
    const device = new DeviceGnss(BUDGET, new Random(2), 0.8)

    let missed = 0

    for (let step = 1; step <= 20_000; step++) {
      field.advanceTo(Math.floor(step / FIELD_TICK_SECONDS))

      const { offset, horizontalAccuracy, verticalAccuracy } = device.sample(field, 1)

      expect(horizontalAccuracy).toBeGreaterThan(0)
      expect(verticalAccuracy).toBeGreaterThan(horizontalAccuracy)

      if (Math.hypot(offset.x, offset.y) > horizontalAccuracy) missed++
    }

    // A one-sigma claim in two dimensions is wrong most of the time. Anything
    // downstream that reads the accuracy as a bound has to meet that here.
    expect(missed / 20_000).toBeGreaterThan(0.2)
  })
})

describe('SharedErrorField', () => {
  it('reaches the same state whether it is stepped in one leap or many', () => {
    const stepped = new SharedErrorField(new Random(5))
    const leapt = new SharedErrorField(new Random(5))

    for (let tick = 1; tick <= 400; tick++) stepped.advanceTo(tick)
    leapt.advanceTo(400)

    expect(leapt.value).toEqual(stepped.value)
  })

  it('never goes backwards', () => {
    const field = new SharedErrorField(new Random(6))

    field.advanceTo(100)
    const settled = field.value

    field.advanceTo(50)

    expect(field.value).toEqual(settled)
  })
})
