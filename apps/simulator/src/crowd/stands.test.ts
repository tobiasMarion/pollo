import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import type { Seat } from './seat.js'
import { PITCH, stands } from './stands.js'

/** Big enough to need several rows — one row seats around seven hundred. */
const CAPACITY = 3_000

function heightOfRow(seats: readonly Seat[], row: number) {
  const inRow = seats.filter(seat => seat.level === row)

  return (inRow[0] as Seat).point.z
}

describe('stands', () => {
  const seats = stands.build(CAPACITY, new Random(1))
  const rows = new Set(seats.map(seat => seat.level))

  it('keeps the crowd off the pitch', () => {
    for (const { point } of seats) {
      const insidePitch =
        Math.abs(point.x) < PITCH.length / 2 && Math.abs(point.y) < PITCH.width / 2

      expect(insidePitch).toBe(false)
    }
  })

  it('adds rows until the crowd fits', () => {
    expect(rows.size).toBeGreaterThan(1)
    expect(
      new Set(stands.build(60_000, new Random(1)).map(seat => seat.level)).size,
    ).toBeGreaterThan(rows.size)
  })

  it('rakes upwards, row by row', () => {
    for (let row = 1; row < rows.size; row++) {
      expect(heightOfRow(seats, row)).toBeGreaterThan(heightOfRow(seats, row - 1))
    }
  })

  it('steps backwards as it climbs', () => {
    const setback = (row: number) =>
      Math.max(...seats.filter(seat => seat.level === row).map(seat => -seat.point.y))

    for (let row = 1; row < rows.size; row++) {
      expect(setback(row)).toBeGreaterThan(setback(row - 1))
    }
  })

  it('seats a crowd in a block rather than a bracelet around the ground', () => {
    // One row all the way round the pitch would leave every device with two
    // neighbours in range — a chain, which is not a crowd.
    const block = stands.build(600, new Random(1))

    expect(new Set(block.map(seat => seat.level)).size).toBeGreaterThan(10)
    expect(block.every(seat => seat.point.y < -PITCH.width / 2)).toBe(true)
  })

  it('wraps around the ground once the block outgrows it', () => {
    const full = stands.build(60_000, new Random(1)).filter(seat => seat.level === 0)

    expect(full.some(seat => seat.point.x > PITCH.length / 2)).toBe(true)
    expect(full.some(seat => seat.point.x < -PITCH.length / 2)).toBe(true)
    expect(full.some(seat => seat.point.y > PITCH.width / 2)).toBe(true)
    expect(full.some(seat => seat.point.y < -PITCH.width / 2)).toBe(true)
  })
})
