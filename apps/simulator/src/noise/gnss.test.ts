import { describe, expect, it } from 'vitest'
import type { Zone } from '../crowd/zones.js'
import { DeviceGnss, FIELD_TICK_SECONDS, SharedErrorField } from './gnss.js'
import { Random } from './random.js'

function zoneAt(index: number, overrides: Partial<Zone> = {}): Zone {
  return {
    index,
    seats: 500,
    centroid: { x: 60, y: 0, z: 5 },
    skyFraction: 0.5,
    hdop: 1.8,
    vdop: 4.2,
    sigmaHorizontal: 7,
    sigmaVertical: 17,
    multipathSusceptibility: 0.5,
    biasDirection: { x: -0.89, y: 0, z: -0.45 },
    ...overrides,
  }
}

function drive(device: DeviceGnss, field: SharedErrorField, samples: number, dt = 1) {
  const readings = []

  for (let i = 1; i <= samples; i++) {
    field.advanceTo(Math.floor((i * dt) / FIELD_TICK_SECONDS))
    readings.push(device.sample(field, dt))
  }

  return readings
}

function standardDeviation(values: readonly number[]) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length)
}

describe('SharedErrorField', () => {
  it('gives every shard the same field for the same seed and tick', () => {
    const left = new SharedErrorField(4242, 48)
    const right = new SharedErrorField(4242, 48)

    left.advanceTo(400)
    right.advanceTo(400)

    expect(left.commonValue()).toEqual(right.commonValue())
    expect(left.sectorValue(7)).toEqual(right.sectorValue(7))
  })

  it('agrees even when one shard falls behind and catches up in one call', () => {
    const steady = new SharedErrorField(99, 48)
    const stalled = new SharedErrorField(99, 48)

    for (let tick = 1; tick <= 200; tick++) steady.advanceTo(tick)
    stalled.advanceTo(200)

    expect(stalled.commonValue()).toEqual(steady.commonValue())
  })

  it('never rewinds', () => {
    const field = new SharedErrorField(5, 48)

    field.advanceTo(100)
    const value = field.commonValue()
    field.advanceTo(50)

    expect(field.commonValue()).toEqual(value)
  })

  it('drives its sectors apart from each other', () => {
    const field = new SharedErrorField(11, 48)
    field.advanceTo(800)

    expect(field.sectorValue(0)).not.toEqual(field.sectorValue(1))
  })
})

describe('DeviceGnss', () => {
  it('holds the sigma its zone asked for on each axis', () => {
    const field = new SharedErrorField(3, 48)
    // No multipath: this is about the well-behaved part of the error.
    const zone = zoneAt(0, { multipathSusceptibility: 0 })
    const device = new DeviceGnss(zone, new Random(21), 0.8)

    const readings = drive(device, field, 40_000)

    expect(standardDeviation(readings.map(reading => reading.offset.x))).toBeGreaterThan(3)
    expect(standardDeviation(readings.map(reading => reading.offset.x))).toBeLessThan(12)
    expect(standardDeviation(readings.map(reading => reading.offset.z))).toBeGreaterThan(
      standardDeviation(readings.map(reading => reading.offset.x)),
    )
  })

  it('makes the vertical error the worse one, sample by sample', () => {
    const field = new SharedErrorField(7, 48)
    const device = new DeviceGnss(zoneAt(0), new Random(22), 0.8)

    const readings = drive(device, field, 20_000)
    const horizontal = standardDeviation(readings.map(reading => reading.offset.y))
    const vertical = standardDeviation(readings.map(reading => reading.offset.z))

    expect(vertical / horizontal).toBeGreaterThan(1.5)
  })

  it('correlates two devices in the same zone, and correlates them less across zones', () => {
    const field = new SharedErrorField(13, 48)

    // Multipath off: this is about how much of the drift the crowd shares.
    const quiet = { multipathSusceptibility: 0 }
    const together = [0, 0].map(
      (zone, index) => new DeviceGnss(zoneAt(zone, quiet), new Random(30 + index), 0.85),
    )
    const apart = new DeviceGnss(zoneAt(9, quiet), new Random(32), 0.85)

    const first: number[] = []
    const second: number[] = []
    const other: number[] = []

    for (let i = 1; i <= 20_000; i++) {
      field.advanceTo(Math.floor(i / FIELD_TICK_SECONDS))
      first.push((together[0] as DeviceGnss).sample(field, 1).offset.x)
      second.push((together[1] as DeviceGnss).sample(field, 1).offset.x)
      other.push(apart.sample(field, 1).offset.x)
    }

    expect(correlation(first, second)).toBeGreaterThan(0.8)
    expect(correlation(first, other)).toBeGreaterThan(0.5)
    expect(correlation(first, other)).toBeLessThan(correlation(first, second))
  })

  it('decorrelates the crowd when the common-mode share is turned off', () => {
    const field = new SharedErrorField(17, 48)

    const first = new DeviceGnss(zoneAt(0, { multipathSusceptibility: 0 }), new Random(40), 0)
    const second = new DeviceGnss(zoneAt(0, { multipathSusceptibility: 0 }), new Random(41), 0)

    const left: number[] = []
    const right: number[] = []

    for (let i = 1; i <= 20_000; i++) {
      field.advanceTo(Math.floor(i / FIELD_TICK_SECONDS))
      left.push(first.sample(field, 1).offset.x)
      right.push(second.sample(field, 1).offset.x)
    }

    expect(Math.abs(correlation(left, right))).toBeLessThan(0.3)
  })

  it('reports an accuracy blind to the reflection it is suffering', () => {
    const field = new SharedErrorField(19, 48)
    const device = new DeviceGnss(zoneAt(0, { multipathSusceptibility: 1 }), new Random(50), 0.8)

    const readings = drive(device, field, 5_000)
    const reflected = readings.filter(reading => reading.reflected)

    expect(reflected.length).toBeGreaterThan(0)

    const claimed = new Set(readings.map(reading => reading.horizontalAccuracy.toFixed(6)))

    // One value throughout: the receiver never learns it is being lied to.
    expect(claimed.size).toBe(1)

    const worstReflected = reflected.reduce(
      (max, reading) => Math.max(max, Math.hypot(reading.offset.x, reading.offset.y)),
      0,
    )

    expect(worstReflected).toBeGreaterThan(readings[0]?.horizontalAccuracy ?? 0)
  })

  it('spends more of its time reflected in an exposed zone than a sheltered one', () => {
    const share = (susceptibility: number, seed: number) => {
      const device = new DeviceGnss(
        zoneAt(0, { multipathSusceptibility: susceptibility }),
        new Random(seed),
        0.8,
      )
      const readings = drive(device, new SharedErrorField(23, 48), 20_000)

      return readings.filter(reading => reading.reflected).length / readings.length
    }

    const exposedShare = share(1, 60)
    const shelteredShare = share(0.1, 61)

    expect(exposedShare).toBeGreaterThan(shelteredShare * 2)
    expect(exposedShare).toBeLessThan(0.4)
  })
})

function correlation(left: readonly number[], right: readonly number[]) {
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length

  let covariance = 0

  for (let i = 0; i < left.length; i++) {
    covariance += ((left[i] ?? 0) - meanLeft) * ((right[i] ?? 0) - meanRight)
  }

  covariance /= left.length

  return covariance / (standardDeviation(left) * standardDeviation(right))
}
