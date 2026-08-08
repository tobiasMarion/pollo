import { describe, expect, it } from 'vitest'
import { Random } from './random.js'
import { Sway } from './sway.js'

function walk(seconds: number, dt = 1, seed = 1) {
  const sway = new Sway(new Random(seed))
  const points = []

  for (let step = 0; step < seconds / dt; step++) points.push(sway.step(dt))

  return points
}

describe('Sway', () => {
  it('shifts around by centimetres, not metres', () => {
    const offsets = walk(20_000).map(point => Math.hypot(point.x, point.y))

    expect(Math.max(...offsets)).toBeLessThan(1)
    expect(offsets.reduce((sum, value) => sum + value, 0) / offsets.length).toBeGreaterThan(0.05)
  })

  it('moves less in height than on the floor', () => {
    const points = walk(20_000)

    const horizontal = Math.max(...points.map(point => Math.abs(point.x)))
    const vertical = Math.max(...points.map(point => Math.abs(point.z)))

    expect(vertical).toBeLessThan(horizontal)
  })

  it('leans rather than teleports', () => {
    const points = walk(600, 0.5)

    for (let i = 1; i < points.length; i++) {
      const before = points[i - 1] as { x: number; y: number }
      const after = points[i] as { x: number; y: number }

      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.15)
    }
  })

  it('comes back to where it started instead of wandering off', () => {
    const points = walk(20_000)
    const late = points.slice(-2_000)

    const drift = Math.hypot(
      late.reduce((sum, point) => sum + point.x, 0) / late.length,
      late.reduce((sum, point) => sum + point.y, 0) / late.length,
    )

    expect(drift).toBeLessThan(0.3)
  })
})
