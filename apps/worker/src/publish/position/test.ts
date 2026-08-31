import type { Location } from '@pollo/contracts'
import { projectLocation, toEcef } from '@pollo/geometry'
import { describe, expect, it } from 'vitest'
import { positionOf } from './index.js'

const origin = { latitude: -29.6842, longitude: -53.8069 }

function location(partial: Partial<Location> = {}): Location {
  return {
    latitude: -29.684,
    longitude: -53.8065,
    altitude: 117.5,
    horizontalAccuracy: 5,
    verticalAccuracy: 12,
    ...partial,
  }
}

describe('positionOf', () => {
  it('reports the reading untouched as the uncorrected pair', () => {
    const reading = location()
    const point = positionOf('a', reading, { x: 40, y: -12, z: 118 }, origin)

    expect(point.deviceId).toBe('a')
    expect(point.position.uncorrected.relative).toEqual(projectLocation(reading, origin))
    expect(point.position.uncorrected.absolute).toEqual(toEcef(reading))
  })

  it('passes the estimate through as the field-frame half of the simulated pair', () => {
    const estimate = { x: 40, y: -12, z: 118 }

    expect(positionOf('a', location(), estimate, origin).position.simulated.relative).toBe(estimate)
  })

  /**
   * The field frame is local and arbitrary — two events a kilometre apart both
   * put their crowds around the origin. The absolute half is what makes a
   * position mean something once it leaves the event that produced it, so it has
   * to be the *estimate* unprojected, not the reading it was anchored on.
   */
  it('sends the estimate round the world rather than the reading it started from', () => {
    const reading = location()
    const estimate = { x: 400, y: -300, z: 130 }

    const point = positionOf('a', reading, estimate, origin)

    expect(point.position.simulated.absolute).not.toEqual(point.position.uncorrected.absolute)

    // Four hundred metres east and three hundred south of the reading, give or
    // take the projection, is where the absolute coordinate has to land.
    const drift = Math.hypot(
      point.position.simulated.absolute.x - point.position.uncorrected.absolute.x,
      point.position.simulated.absolute.y - point.position.uncorrected.absolute.y,
      point.position.simulated.absolute.z - point.position.uncorrected.absolute.z,
    )

    expect(drift).toBeGreaterThan(400)
    expect(drift).toBeLessThan(600)
  })

  /**
   * The accuracies describe the GPS fix that anchored the estimate, not the
   * estimate itself. Inventing a number for the estimate would be claiming a
   * confidence nothing here computes — so an estimate exactly on the reading
   * comes back as the same point in both frames.
   */
  it('leaves an estimate that agrees with the reading indistinguishable from it', () => {
    const reading = location()
    const point = positionOf('a', reading, projectLocation(reading, origin), origin)

    expect(point.position.simulated.absolute.x).toBeCloseTo(
      point.position.uncorrected.absolute.x,
      6,
    )
    expect(point.position.simulated.absolute.y).toBeCloseTo(
      point.position.uncorrected.absolute.y,
      6,
    )
    expect(point.position.simulated.absolute.z).toBeCloseTo(
      point.position.uncorrected.absolute.z,
      6,
    )
  })
})
