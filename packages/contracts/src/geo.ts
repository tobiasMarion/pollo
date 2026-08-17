import type { Vector3 } from './graph.js'
import type { Location } from './location.js'

const METERS_PER_DEGREE_LATITUDE = 110_574
const METERS_PER_DEGREE_LONGITUDE = 111_320

/** What both directions of the projection need to know about the event. */
export type Origin = { latitude: number; longitude: number }

function metersPerDegreeLongitudeAt(originLatitude: number) {
  return METERS_PER_DEGREE_LONGITUDE * Math.cos((originLatitude * Math.PI) / 180)
}

/**
 * Equirectangular projection around the event origin, in meters east/north/up.
 * Events span a field, not a continent, so the error over a few hundred meters
 * is far below GPS noise.
 */
export function projectLocation(location: Location, origin: Origin): Vector3 {
  return {
    x: (location.longitude - origin.longitude) * metersPerDegreeLongitudeAt(origin.latitude),
    y: (location.latitude - origin.latitude) * METERS_PER_DEGREE_LATITUDE,
    z: location.altitude,
  }
}

/** WGS 84, the ellipsoid every GPS receiver reports against. */
const EARTH_SEMI_MAJOR_AXIS = 6_378_137
const EARTH_FLATTENING = 1 / 298.257_223_563
const EARTH_ECCENTRICITY_SQUARED = EARTH_FLATTENING * (2 - EARTH_FLATTENING)

/**
 * A geodetic reading as an Earth-centred, Earth-fixed coordinate — the
 * `absolute` half of a `PositionPair`.
 *
 * The field frame is local and arbitrary: two events a kilometre apart both put
 * their crowds around the origin, and nothing about those coordinates says where
 * on the planet they were. ECEF is the frame that does, so a position stays
 * meaningful once it leaves the event that produced it.
 *
 * `x` points at the prime meridian on the equator, `z` at the north pole, all in
 * meters from the centre of the earth.
 */
export function toEcef(location: {
  latitude: number
  longitude: number
  altitude: number
}): Vector3 {
  const latitude = (location.latitude * Math.PI) / 180
  const longitude = (location.longitude * Math.PI) / 180

  const sinLatitude = Math.sin(latitude)
  const cosLatitude = Math.cos(latitude)

  // Distance from the polar axis to the ellipsoid along the surface normal. On a
  // sphere this would be the radius; the ellipsoid makes it depend on latitude.
  const primeVertical =
    EARTH_SEMI_MAJOR_AXIS / Math.sqrt(1 - EARTH_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude)

  return {
    x: (primeVertical + location.altitude) * cosLatitude * Math.cos(longitude),
    y: (primeVertical + location.altitude) * cosLatitude * Math.sin(longitude),
    z: (primeVertical * (1 - EARTH_ECCENTRICITY_SQUARED) + location.altitude) * sinLatitude,
  }
}

/**
 * The inverse: a point in the field frame back to the coordinates a device
 * would report. Accuracies are not derivable from a position, so the caller
 * supplies them — a simulated device knows how badly it is lying, a real one
 * reads it off the fix.
 */
export function unprojectLocation(
  point: Vector3,
  origin: Origin,
  accuracy: { horizontalAccuracy: number; verticalAccuracy: number },
): Location {
  return {
    latitude: origin.latitude + point.y / METERS_PER_DEGREE_LATITUDE,
    longitude: origin.longitude + point.x / metersPerDegreeLongitudeAt(origin.latitude),
    altitude: point.z,
    horizontalAccuracy: accuracy.horizontalAccuracy,
    verticalAccuracy: accuracy.verticalAccuracy,
  }
}
