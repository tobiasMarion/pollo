import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import {
  buildSeats,
  occupySeats,
  rowHeight,
  stadium,
  superellipsePoint,
  tiers,
  ZONE_COUNT,
  zoneIndex,
} from './bowl.js'

const seats = buildSeats(new Random(1))

describe('superellipsePoint', () => {
  it('meets the axes at the semi-axes themselves', () => {
    const east = superellipsePoint(0, 60, 40, 4)
    const north = superellipsePoint(Math.PI / 2, 60, 40, 4)

    expect(east.x).toBeCloseTo(60, 6)
    expect(east.y).toBeCloseTo(0, 6)
    expect(north.x).toBeCloseTo(0, 6)
    expect(north.y).toBeCloseTo(40, 6)
  })

  it('bulges past the ellipse at the corners, which is the whole point', () => {
    const rounded = superellipsePoint(Math.PI / 4, 60, 40, 4)
    const ellipse = superellipsePoint(Math.PI / 4, 60, 40, 2)

    expect(Math.hypot(rounded.x, rounded.y)).toBeGreaterThan(Math.hypot(ellipse.x, ellipse.y))
  })

  it('stays on the curve all the way round', () => {
    for (let i = 0; i < 64; i++) {
      const { x, y } = superellipsePoint((i / 64) * 2 * Math.PI, 60, 40, 4)
      const value = Math.abs(x / 60) ** 4 + Math.abs(y / 40) ** 4

      expect(value).toBeCloseTo(1, 6)
    }
  })
})

describe('buildSeats', () => {
  it('holds a stadium-sized crowd', () => {
    expect(seats.length).toBeGreaterThan(20_000)
  })

  it('clears the pitch — nobody stands on the grass', () => {
    const halfLength = stadium.pitchLength / 2
    const halfWidth = stadium.pitchWidth / 2

    for (const seat of seats) {
      const onPitch = Math.abs(seat.point.x) < halfLength && Math.abs(seat.point.y) < halfWidth
      expect(onPitch).toBe(false)
    }
  })

  it('rakes every row above the one in front of it', () => {
    for (const name of ['LOWER', 'UPPER'] as const) {
      const tier = tiers[name]
      const rows = Array.from({ length: tier.rows }, (_, row) => rowHeight(tier, row))

      for (let row = 1; row < rows.length; row++) {
        expect(rows[row]).toBeGreaterThan(rows[row - 1] ?? 0)
      }
    }
  })

  it('holds the phone above the deck it stands on', () => {
    const front = seats.filter(seat => seat.tier === 'LOWER' && seat.row === 0)

    for (const seat of front) {
      expect(seat.point.z).toBeGreaterThan(tiers.LOWER.startHeight)
    }
  })

  it('leaves stairways rather than a seamless carpet', () => {
    const frontRow = seats.filter(seat => seat.tier === 'LOWER' && seat.row === 0)
    const gaps = frontRow
      .map(seat => seat.azimuth)
      .sort((left, right) => left - right)
      .map((angle, index, all) => (index === 0 ? 0 : angle - (all[index - 1] ?? 0)))

    const widest = gaps.reduce((max, gap) => Math.max(max, gap), 0)
    const typical = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length

    expect(widest).toBeGreaterThan(typical * 3)
  })

  it('spaces neighbours by roughly the seat pitch', () => {
    const row = seats
      .filter(seat => seat.tier === 'LOWER' && seat.row === 5)
      .sort((left, right) => left.azimuth - right.azimuth)

    const spacings: number[] = []

    for (let i = 1; i < row.length; i++) {
      const previous = row[i - 1]
      const current = row[i]
      if (!previous || !current) continue

      spacings.push(
        Math.hypot(current.point.x - previous.point.x, current.point.y - previous.point.y),
      )
    }

    // Stairways leave wider gaps, so the median is what carries the pitch.
    const median = spacings.sort((left, right) => left - right)[Math.floor(spacings.length / 2)]

    expect(median).toBeCloseTo(stadium.seatPitch, 1)
  })

  it('is reproducible from the seed', () => {
    const again = buildSeats(new Random(1))

    expect(again[0]).toEqual(seats[0])
    expect(again.length).toBe(seats.length)
  })
})

describe('zoneIndex', () => {
  it('stays inside the table for every seat', () => {
    for (const seat of seats) {
      expect(seat.zone).toBeGreaterThanOrEqual(0)
      expect(seat.zone).toBeLessThan(ZONE_COUNT)
    }
  })

  it('separates the tiers', () => {
    const lower = zoneIndex('LOWER', 0, 30, 0)
    const upper = zoneIndex('UPPER', 0, 25, 0)

    expect(lower).not.toBe(upper)
  })

  it('handles a negative azimuth, which is what atan2 returns half the time', () => {
    const zone = zoneIndex('LOWER', 0, 30, -Math.PI / 2)

    expect(zone).toBeGreaterThanOrEqual(0)
    expect(zone).toBeLessThan(ZONE_COUNT)
  })
})

describe('occupySeats', () => {
  it('takes exactly the number of seats asked for, without repeating one', () => {
    const taken = occupySeats(seats, 5_000, new Random(2))

    expect(taken).toHaveLength(5_000)
    expect(new Set(taken).size).toBe(5_000)
  })

  it('fills the lower ring before the upper one', () => {
    const taken = occupySeats(seats, 5_000, new Random(3))
    const lower = taken.filter(index => seats[index]?.tier === 'LOWER').length

    expect(lower / taken.length).toBeGreaterThan(0.6)
  })

  it('leaves the crowd uneven rather than uniform', () => {
    const taken = occupySeats(seats, 8_000, new Random(4))
    const perZone = new Array<number>(ZONE_COUNT).fill(0)

    for (const index of taken) {
      const seat = seats[index]
      if (seat) perZone[seat.zone] = (perZone[seat.zone] ?? 0) + 1
    }

    const occupancies = perZone
      .map((count, zone) => {
        const available = seats.filter(seat => seat.zone === zone).length
        return available === 0 ? null : count / available
      })
      .filter((value): value is number => value !== null)

    const average = occupancies.reduce((sum, value) => sum + value, 0) / occupancies.length
    const spread = Math.sqrt(
      occupancies.reduce((sum, value) => sum + (value - average) ** 2, 0) / occupancies.length,
    )

    expect(spread).toBeGreaterThan(0.02)
  })

  it('refuses a crowd larger than the stadium', () => {
    expect(() => occupySeats(seats, seats.length + 1, new Random(5))).toThrow(/lower --clients/)
  })
})
