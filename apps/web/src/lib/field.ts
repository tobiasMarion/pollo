import type { DeviceLocation, Vector3 } from '$lib/api/types';
import type { DeviceState } from '$lib/event-console.svelte';

export interface FieldPixel {
  deviceId: string;
  /** Meters east/north/up of the event origin. */
  point: Vector3;
  /**
   * True when the worker placed this pixel. False means the panel is falling
   * back to the device's own GPS reading, which is metres-accurate at best —
   * those are drawn as outlines, never as light.
   */
  placed: boolean;
}

const METERS_PER_DEGREE_LATITUDE = 110_574;
const METERS_PER_DEGREE_LONGITUDE = 111_320;

/**
 * Equirectangular projection around the event origin. Events span a field, not
 * a continent, so the error over a few hundred meters is far below GPS noise.
 */
export function projectLocation(
  location: DeviceLocation,
  origin: { latitude: number; longitude: number },
): Vector3 {
  const latitudeRadians = (origin.latitude * Math.PI) / 180;

  return {
    x:
      (location.longitude - origin.longitude) *
      METERS_PER_DEGREE_LONGITUDE *
      Math.cos(latitudeRadians),
    y: (location.latitude - origin.latitude) * METERS_PER_DEGREE_LATITUDE,
    z: location.altitude,
  };
}

export function toFieldPixels(
  devices: Iterable<DeviceState>,
  origin: { latitude: number; longitude: number },
): FieldPixel[] {
  return [...devices].flatMap((device): FieldPixel[] => {
    if (device.position) {
      return [
        { deviceId: device.deviceId, point: device.position.simulated.relative, placed: true },
      ];
    }

    if (device.location) {
      return [
        {
          deviceId: device.deviceId,
          point: projectLocation(device.location, origin),
          placed: false,
        },
      ];
    }

    return [];
  });
}
