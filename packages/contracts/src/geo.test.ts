import { describe, expect, it } from 'vitest'
import { projectLocation, unprojectLocation } from './geo.js'

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
