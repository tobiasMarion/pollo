import { describe, expect, it } from 'vitest'
import { Random } from '../noise/random.js'
import { PHONE_HEIGHT, SEAT_PITCH } from './seat.js'
import { square } from './square.js'

function extent(values: readonly number[]) {
  return Math.max(...values) - Math.min(...values)
}

describe('square', () => {
  const seats = square.build(1_000, new Random(1))

  it('is one bank of people, with no levels in it', () => {
    expect(seats.every(seat => seat.level === 0)).toBe(true)
  })

  it('is flat — the only venue that is', () => {
    for (const seat of seats) expect(seat.point.z).toBeCloseTo(PHONE_HEIGHT, 1)
  })

  it('is square, and centred on the origin', () => {
    const xs = seats.map(seat => seat.point.x)
    const ys = seats.map(seat => seat.point.y)

    expect(extent(xs)).toBeCloseTo(extent(ys), 1)
    expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 1)
    expect(Math.max(...ys)).toBeCloseTo(-Math.min(...ys), 1)
  })

  it('grows by its side, not by its area', () => {
    const small = square.build(100, new Random(2))
    const large = square.build(400, new Random(2))

    expect(extent(large.map(seat => seat.point.x))).toBeCloseTo(
      2 * extent(small.map(seat => seat.point.x)),
      0,
    )
  })

  it('packs the crowd at the seat pitch', () => {
    const side = Math.ceil(Math.sqrt(1_000))

    expect(extent(seats.map(seat => seat.point.x))).toBeCloseTo((side - 1) * SEAT_PITCH, 0)
  })
})
