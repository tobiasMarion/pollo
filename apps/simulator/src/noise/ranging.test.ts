import { describe, expect, it } from 'vitest'
import { Random } from './random.js'
import { Ranging } from './ranging.js'

function heard(ranging: Ranging, distance: number, count: number, crowdFactor = 1) {
  const samples = []

  for (let i = 0; i < count; i++) {
    const sample = ranging.measure(distance, crowdFactor)
    if (sample.distance !== null) samples.push(sample)
  }

  return samples
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

describe('Ranging', () => {
  it('hears nothing past the radio range', () => {
    const ranging = new Ranging(new Random(1), 15)

    for (let i = 0; i < 1_000; i++) {
      expect(ranging.measure(15.01).distance).toBeNull()
    }
  })

  it('hears a close peer far more often than a distant one', () => {
    const ranging = new Ranging(new Random(2), 15)

    const near = heard(ranging, 1, 5_000).length / 5_000
    const far = heard(ranging, 14, 5_000).length / 5_000

    expect(near).toBeGreaterThan(0.9)
    expect(far).toBeLessThan(0.3)
    expect(far).toBeGreaterThan(0)
  })

  it('leaves the graph sparse rather than complete', () => {
    const ranging = new Ranging(new Random(3), 15)
    const distances = [2, 5, 8, 11, 14]

    const overall =
      distances.reduce((sum, distance) => sum + heard(ranging, distance, 2_000).length, 0) /
      (distances.length * 2_000)

    expect(overall).toBeLessThan(0.8)
  })

  it('is unbiased in the log domain when nothing blocks the path', () => {
    const ranging = new Ranging(new Random(4), 20)
    const samples = heard(ranging, 6, 40_000, 0)

    expect(median(samples.map(sample => sample.distance ?? 0))).toBeCloseTo(6, 0)
  })

  it('errs multiplicatively, so a distant reading is wrong by more meters', () => {
    const ranging = new Ranging(new Random(5), 40)

    const spread = (distance: number) => {
      const values = heard(ranging, distance, 20_000, 0).map(sample => sample.distance ?? 0)
      const sorted = values.sort((left, right) => left - right)
      const low = sorted[Math.floor(sorted.length * 0.16)] ?? 0
      const high = sorted[Math.floor(sorted.length * 0.84)] ?? 0

      return { absolute: high - low, relative: (high - low) / distance }
    }

    const near = spread(3)
    const far = spread(12)

    expect(far.absolute).toBeGreaterThan(near.absolute * 2)
    expect(far.relative).toBeCloseTo(near.relative, 1)
  })

  it('reads a blocked path as farther, never as nearer', () => {
    const ranging = new Ranging(new Random(6), 20)
    const samples = heard(ranging, 8, 60_000)

    const clear = samples.filter(sample => !sample.blocked).map(sample => sample.distance ?? 0)
    const blocked = samples.filter(sample => sample.blocked).map(sample => sample.distance ?? 0)

    expect(blocked.length).toBeGreaterThan(1_000)
    expect(median(blocked)).toBeGreaterThan(median(clear))
  })

  it('blocks more often the farther the peer and the denser the crowd', () => {
    const ranging = new Ranging(new Random(7), 20)

    const blockedShare = (distance: number, crowdFactor: number) => {
      const samples = heard(ranging, distance, 20_000, crowdFactor)
      return samples.filter(sample => sample.blocked).length / samples.length
    }

    expect(blockedShare(12, 1)).toBeGreaterThan(blockedShare(3, 1))
    expect(blockedShare(6, 1.5)).toBeGreaterThan(blockedShare(6, 0.5))
    expect(blockedShare(6, 0)).toBe(0)
  })

  it('never returns a negative or zero distance', () => {
    const ranging = new Ranging(new Random(8), 15)

    for (const sample of heard(ranging, 10, 20_000)) {
      expect(sample.distance).toBeGreaterThan(0)
    }
  })

  it('discards a measurement its own radio could not have produced', () => {
    const capped = new Ranging(new Random(10), 6, 6)
    const samples = heard(capped, 5, 60_000)

    expect(samples.length).toBeGreaterThan(1_000)

    for (const sample of samples) {
      expect(sample.distance).toBeLessThanOrEqual(6)
    }
  })

  it('reports the long tail when no cap is set', () => {
    const uncapped = new Ranging(new Random(11), 6)
    const samples = heard(uncapped, 5, 60_000).map(sample => sample.distance ?? 0)

    // Multiplicative error with a positive blockage bias: without a cap the
    // wire carries distances a six-metre radio could never have measured.
    expect(samples.some(distance => distance > 20)).toBe(true)
  })

  it('censors rather than clamps — no pile-up at the cap', () => {
    const capped = new Ranging(new Random(12), 6, 6)
    const samples = heard(capped, 5, 60_000).map(sample => sample.distance ?? 0)

    const nearCap = samples.filter(distance => distance > 5.9).length / samples.length

    expect(nearCap).toBeLessThan(0.05)
  })

  it('replays identically from the same seed', () => {
    const first = heard(new Ranging(new Random(9), 15), 7, 200)
    const second = heard(new Ranging(new Random(9), 15), 7, 200)

    expect(first).toEqual(second)
  })
})
