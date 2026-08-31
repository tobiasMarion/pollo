import type { Location, PositionPoint } from '@pollo/contracts'
import {
  type Origin,
  projectLocation,
  toEcef,
  unprojectLocation,
  type Vector3,
} from '@pollo/geometry'

/**
 * Assembles the four coordinates the wire asks for out of the two the worker
 * actually has: the device's own GPS reading, and where the solve put it.
 *
 * `relative` is the field frame — meters east, north and up of the event origin
 * — which is the only one anything downstream draws. `absolute` is the same
 * point seen from the centre of the earth, which is what makes a position mean
 * something once it leaves the event that produced it.
 *
 * The accuracies ride along unchanged. They describe the GPS fix that anchored
 * the estimate, not the estimate itself, and inventing a number for the estimate
 * would be claiming a confidence nothing here computes.
 */
export function positionOf(
  deviceId: string,
  location: Location,
  estimate: Vector3,
  origin: Origin,
): PositionPoint {
  return {
    deviceId,
    position: {
      uncorrected: {
        relative: projectLocation(location, origin),
        absolute: toEcef(location),
      },
      simulated: {
        relative: estimate,
        absolute: toEcef(unprojectLocation(estimate, origin, location)),
      },
    },
  }
}
