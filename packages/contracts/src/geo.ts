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
