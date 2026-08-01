import { projectLocation, type Vector3 } from '@pollo/contracts'
import type { DeviceState } from '$lib/event-console.svelte'

export interface FieldPixel {
  deviceId: string
  /** Meters east/north/up of the event origin. */
  point: Vector3
  /**
   * True when the worker placed this pixel. False means the panel is falling
   * back to the device's own GPS reading, which is metres-accurate at best —
   * those are drawn as outlines, never as light.
   */
  placed: boolean
}

export function toFieldPixels(
  devices: Iterable<DeviceState>,
  origin: { latitude: number; longitude: number },
): FieldPixel[] {
  return [...devices].flatMap((device): FieldPixel[] => {
    if (device.position) {
      return [
        { deviceId: device.deviceId, point: device.position.simulated.relative, placed: true },
      ]
    }

    if (device.location) {
      return [
        {
          deviceId: device.deviceId,
          point: projectLocation(device.location, origin),
          placed: false,
        },
      ]
    }

    return []
  })
}
