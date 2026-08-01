import { type Origin, projectLocation, type Vector3 } from '@pollo/contracts'
import type { DeviceState } from '$lib/event-console.svelte'

export interface FieldPixel {
  deviceId: string
  /** Where the device is now, in meters east/north/up of the event origin. */
  point: Vector3
  /**
   * Where it was before the last batch. The field arrives once a second, so the
   * canvas glides from here to `point` instead of letting the crowd tick.
   */
  from: Vector3
  /** When the glide started and how long it has, both in milliseconds. */
  since: number
  window: number
  /**
   * True when the worker placed this pixel. False means the panel is falling
   * back to the device's own GPS reading, which is metres-accurate at best —
   * those are drawn as outlines, never as light.
   */
  placed: boolean
}

/** Where a device sits, given what is known about it. */
function pointOf(
  location: DeviceState['location'],
  position: DeviceState['position'],
  origin: Origin,
): Vector3 | null {
  if (position) return position.simulated.relative
  if (location) return projectLocation(location, origin)

  return null
}

export function toFieldPixels(devices: Iterable<DeviceState>, origin: Origin): FieldPixel[] {
  const pixels: FieldPixel[] = []

  for (const device of devices) {
    const point = pointOf(device.location, device.position, origin)
    if (!point) continue

    // A device with no earlier reading, or one that has just been placed for
    // the first time, has nowhere to come from and should appear where it is
    // rather than fly in from the last thing that was known about it.
    const previous = pointOf(device.previousLocation, device.previousPosition, origin) ?? point

    pixels.push({
      deviceId: device.deviceId,
      point,
      from: previous,
      since: device.changedAt,
      window: device.window,
      placed: device.position !== null,
    })
  }

  return pixels
}
