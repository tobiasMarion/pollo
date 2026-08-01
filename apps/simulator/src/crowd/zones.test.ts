import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import { buildSeats, tiers, ZONE_COUNT } from './bowl.js'
import { buildZones } from './zones.js'

const seats = buildSeats(new Random(1))
const zones = buildZones(seats)
const inhabited = zones.filter(zone => zone.seats > 0)

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

describe('buildZones', () => {
  it('answers for every zone the seats can land in', () => {
    expect(zones).toHaveLength(ZONE_COUNT)
    expect(inhabited.length).toBeGreaterThan(0)

    for (const seat of seats) {
      expect(zones[seat.zone]?.seats).toBeGreaterThan(0)
    }
  })

  it('accounts for every seat exactly once', () => {
    const counted = zones.reduce((sum, zone) => sum + zone.seats, 0)

    expect(counted).toBe(seats.length)
  })
})

describe('the sky a seat can see', () => {
  it('is never the whole hemisphere — everyone is inside a bowl', () => {
    for (const zone of inhabited) {
      expect(zone.skyFraction).toBeGreaterThan(0)
      expect(zone.skyFraction).toBeLessThan(1)
    }
  })

  it('is worse under the canopy than in the open lower ring', () => {
    const roofedZones = new Set(
      seats.filter(seat => tiers[seat.tier].roofed).map(seat => seat.zone),
    )

    const roofed = inhabited.filter(zone => roofedZones.has(zone.index))
    const open = inhabited.filter(zone => !roofedZones.has(zone.index))

    expect(average(roofed.map(zone => zone.skyFraction))).toBeLessThan(
      average(open.map(zone => zone.skyFraction)),
    )
  })
})

describe('dilution of precision', () => {
  it('always punishes the vertical harder than the horizontal', () => {
    for (const zone of inhabited) {
      expect(zone.vdop).toBeGreaterThan(zone.hdop)
      expect(zone.sigmaVertical).toBeGreaterThan(zone.sigmaHorizontal)
    }
  })

  it('keeps the vertical between two and three times the horizontal', () => {
    for (const zone of inhabited) {
      const ratio = zone.sigmaVertical / zone.sigmaHorizontal

      expect(ratio).toBeGreaterThan(1.75)
      expect(ratio).toBeLessThan(3)
    }
  })

  it('stays inside what a receiver would actually report', () => {
    for (const zone of inhabited) {
      expect(zone.sigmaHorizontal).toBeGreaterThan(3)
      expect(zone.sigmaHorizontal).toBeLessThan(20)
      expect(zone.sigmaVertical).toBeLessThan(40)
    }
  })

  it('degrades as the sky closes in', () => {
    const sorted = [...inhabited].sort((left, right) => left.skyFraction - right.skyFraction)
    const worst = sorted[0]
    const best = sorted[sorted.length - 1]

    expect(worst?.sigmaHorizontal).toBeGreaterThan(best?.sigmaHorizontal ?? 0)
    expect(worst?.sigmaVertical).toBeGreaterThan(best?.sigmaVertical ?? 0)
  })
})

describe('multipath', () => {
  it('scores every zone inside [0, 1]', () => {
    for (const zone of inhabited) {
      expect(zone.multipathSusceptibility).toBeGreaterThanOrEqual(0)
      expect(zone.multipathSusceptibility).toBeLessThanOrEqual(1)
    }
  })

  it('points its bias inward over the pitch and downward', () => {
    for (const zone of inhabited) {
      const { biasDirection: bias, centroid } = zone

      expect(Math.hypot(bias.x, bias.y, bias.z)).toBeCloseTo(1, 9)
      expect(bias.z).toBeLessThan(0)

      // Inward means opposed to the seat's own heading from the centre.
      const outward = Math.hypot(centroid.x, centroid.y)
      const dot = (bias.x * centroid.x + bias.y * centroid.y) / outward

      expect(dot).toBeLessThan(0)
    }
  })
})
