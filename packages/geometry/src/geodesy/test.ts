import { describe, expect, it } from 'vitest'
import { projectLocation, toEcef, unprojectLocation } from './index.js'

const origin = { latitude: -29.6842, longitude: -53.8069 }
const accuracy = { horizontalAccuracy: 5, verticalAccuracy: 12 }

describe('projectLocation', () => {
  it('puts the origin itself at x=y=0', () => {
    const point = projectLocation({ ...origin, altitude: 0, ...accuracy }, origin)

    expect(point.x).toBeCloseTo(0, 9)
    expect(point.y).toBeCloseTo(0, 9)
  })

  it('carries altitude through as z', () => {
    const point = projectLocation({ ...origin, altitude: 117.5, ...accuracy }, origin)

    expect(point.z).toBe(117.5)
  })

  it('shrinks longitude by the cosine of the latitude', () => {
    const east = projectLocation(
      { ...origin, longitude: origin.longitude + 0.001, altitude: 0, ...accuracy },
      origin,
    )
    const north = projectLocation(
      { ...origin, latitude: origin.latitude + 0.001, altitude: 0, ...accuracy },
      origin,
    )

    // At ~30° south a degree of longitude is the shorter one.
    expect(east.x).toBeLessThan(north.y)
  })
})

describe('toEcef', () => {
  it('puts the equator on the prime meridian on the x axis, at the semi-major axis', () => {
    const point = toEcef({ latitude: 0, longitude: 0, altitude: 0 })

    expect(point.x).toBeCloseTo(6_378_137, 3)
    expect(point.y).toBeCloseTo(0, 6)
    expect(point.z).toBeCloseTo(0, 6)
  })

  it('puts a quarter turn east on the y axis', () => {
    const point = toEcef({ latitude: 0, longitude: 90, altitude: 0 })

    expect(point.x).toBeCloseTo(0, 6)
    expect(point.y).toBeCloseTo(6_378_137, 3)
  })

  it('puts the north pole on the semi-minor axis, which is the shorter one', () => {
    const point = toEcef({ latitude: 90, longitude: 0, altitude: 0 })

    // b = a·√(1−e²): the flattening is the whole reason this is not 6 378 137.
    expect(point.x).toBeCloseTo(0, 6)
    expect(point.y).toBeCloseTo(0, 6)
    expect(point.z).toBeCloseTo(6_356_752.314_245, 3)
  })

  it('adds altitude along the surface normal', () => {
    const ground = toEcef({ latitude: 0, longitude: 0, altitude: 0 })
    const raised = toEcef({ latitude: 0, longitude: 0, altitude: 250 })

    expect(raised.x - ground.x).toBeCloseTo(250, 6)
  })

  /**
   * The defining property, and the one that catches an error in the prime
   * vertical anywhere between the poles: every point at zero altitude satisfies
   * (x² + y²)/a² + z²/b² = 1.
   *
   * Checking a handful of hand-computed coordinates would only pin the latitudes
   * that were checked; this pins the surface.
   */
  it('puts every point at zero altitude on the WGS 84 ellipsoid', () => {
    const a = 6_378_137
    const b = 6_356_752.314_245_179

    for (const latitude of [-89, -29.6842, -0.5, 0, 12.25, 45, 78.9]) {
      const point = toEcef({ latitude, longitude: -53.8069, altitude: 0 })

      const onEllipsoid =
        (point.x * point.x + point.y * point.y) / (a * a) + (point.z * point.z) / (b * b)

      expect(onEllipsoid).toBeCloseTo(1, 12)
    }
  })

  /**
   * Distance has to survive the change of frame, or `absolute` is decoration. A
   * move straight up is the one displacement whose length is exact in both
   * frames — anything horizontal would be measuring the equirectangular
   * projection's approximation instead of this conversion.
   */
  it('turns a vertical move into exactly that much distance', () => {
    const ground = toEcef({ ...origin, altitude: 100 })
    const raised = toEcef({ ...origin, altitude: 230 })

    const moved = Math.hypot(raised.x - ground.x, raised.y - ground.y, raised.z - ground.z)

    // Nanometres, which is all a double has left after differencing coordinates
    // of six million metres.
    expect(moved).toBeCloseTo(130, 8)
  })
})

describe('unprojectLocation', () => {
  it('round-trips a point through both directions', () => {
    const point = { x: 84.25, y: -37.5, z: 118.25 }

    const roundTripped = projectLocation(unprojectLocation(point, origin, accuracy), origin)

    expect(roundTripped.x).toBeCloseTo(point.x, 6)
    expect(roundTripped.y).toBeCloseTo(point.y, 6)
    expect(roundTripped.z).toBeCloseTo(point.z, 6)
  })

  it('round-trips a location through both directions', () => {
    const location = {
      latitude: -29.6851,
      longitude: -53.8055,
      altitude: 121,
      ...accuracy,
    }

    const roundTripped = unprojectLocation(projectLocation(location, origin), origin, accuracy)

    expect(roundTripped.latitude).toBeCloseTo(location.latitude, 9)
    expect(roundTripped.longitude).toBeCloseTo(location.longitude, 9)
    expect(roundTripped.altitude).toBeCloseTo(location.altitude, 9)
  })

  it('reports the accuracies it was handed rather than deriving them', () => {
    const location = unprojectLocation({ x: 0, y: 0, z: 0 }, origin, {
      horizontalAccuracy: 3.5,
      verticalAccuracy: 21,
    })

    expect(location.horizontalAccuracy).toBe(3.5)
    expect(location.verticalAccuracy).toBe(21)
  })
})
