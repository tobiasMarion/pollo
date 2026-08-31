import type { Location } from '@pollo/contracts'
import { type Origin, projectLocation, type Vector3 } from '@pollo/geometry'

const INITIAL_CAPACITY = 256

/**
 * Who is in the event, and where each of them says they are.
 *
 * Devices live in **slots** rather than in a map keyed by id: every number the
 * solver will keep about a device — where it is, where its GPS puts it, how much
 * evidence it has absorbed — is one flat array indexed the same way, and a slot
 * freed by a departure is handed to the next arrival. A map of objects would
 * cost a pointer chase per device per sweep, several times a second, forever.
 *
 * Ids only appear at the edges: coming in from the stream, going out on the wire.
 */
export class SlotTable {
  private readonly byDevice = new Map<string, number>()
  private readonly free: number[] = []
  private readonly released: number[] = []

  private deviceIds: (string | null)[] = []
  private locations: (Location | null)[] = []
  /** Where each device's own GPS puts it, in the field frame. Three per slot. */
  private anchorsBuffer = new Float64Array(INITIAL_CAPACITY * 3)

  private liveCount = 0

  constructor(readonly origin: Origin) {}

  get size() {
    return this.liveCount
  }

  /** Slot count, live and free alike — the length every flat array is indexed by. */
  get capacity() {
    return this.deviceIds.length
  }

  get anchors(): Readonly<Float64Array> {
    return this.anchorsBuffer
  }

  slotOf(deviceId: string) {
    return this.byDevice.get(deviceId)
  }

  deviceAt(slot: number) {
    return this.deviceIds[slot] ?? undefined
  }

  locationAt(slot: number) {
    return this.locations[slot] ?? undefined
  }

  anchorAt(slot: number): Vector3 {
    return {
      x: this.anchorsBuffer[slot * 3] ?? 0,
      y: this.anchorsBuffer[slot * 3 + 1] ?? 0,
      z: this.anchorsBuffer[slot * 3 + 2] ?? 0,
    }
  }

  /** Every live slot, ascending. The order a keyframe goes out in. */
  *liveSlots() {
    for (let slot = 0; slot < this.deviceIds.length; slot++) {
      if (this.deviceIds[slot] !== null) yield slot
    }
  }

  /**
   * Slots freed by departures since the last call.
   *
   * Anything else keeping a flat array alongside this one has to be told, or a
   * slot handed to a newcomer arrives carrying the previous tenant's history.
   */
  drainReleased() {
    return this.released.splice(0)
  }

  /** Records a reading, claiming a slot if this device is new. */
  place(deviceId: string, location: Location) {
    const existing = this.byDevice.get(deviceId)
    const slot = existing ?? this.claim(deviceId)
    const anchor = projectLocation(location, this.origin)

    this.locations[slot] = location
    this.anchorsBuffer[slot * 3] = anchor.x
    this.anchorsBuffer[slot * 3 + 1] = anchor.y
    this.anchorsBuffer[slot * 3 + 2] = anchor.z

    return { slot, arrived: existing === undefined }
  }

  /** The slot the departing device was in, or nothing if it was never here. */
  release(deviceId: string) {
    const slot = this.byDevice.get(deviceId)

    if (slot === undefined) return undefined

    this.byDevice.delete(deviceId)
    this.deviceIds[slot] = null
    this.locations[slot] = null
    this.liveCount--

    // Handed to the next arrival. Whatever the solver left in the flat arrays at
    // this index is overwritten on the way in, never read on the way out.
    this.free.push(slot)
    this.released.push(slot)

    return slot
  }

  private claim(deviceId: string) {
    const slot = this.free.pop() ?? this.deviceIds.length

    if (slot === this.deviceIds.length) {
      this.deviceIds.push(null)
      this.locations.push(null)
      this.grow(slot + 1)
    }

    this.deviceIds[slot] = deviceId
    this.byDevice.set(deviceId, slot)
    this.liveCount++

    return slot
  }

  private grow(needed: number) {
    if (needed * 3 <= this.anchorsBuffer.length) return

    const grown = new Float64Array(Math.max(needed, this.deviceIds.length * 2) * 3)
    grown.set(this.anchorsBuffer)
    this.anchorsBuffer = grown
  }
}
