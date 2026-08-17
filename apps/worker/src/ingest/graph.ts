import {
  type IngestMessage,
  type Location,
  type Origin,
  projectLocation,
  type Vector3,
} from '@pollo/contracts'

const INITIAL_CAPACITY = 256

/**
 * One event's graph, as the worker holds it.
 *
 * Devices live in **slots** rather than in a map keyed by id: every number the
 * solver will keep about a device — where it is, where its GPS puts it, how much
 * evidence it has absorbed — is one flat array indexed the same way, and a slot
 * freed by a departure is handed to the next arrival. A map of objects would
 * cost a pointer chase per device per sweep, several times a second, forever.
 *
 * Ids only appear at the edges: coming in from the stream, going out on the wire.
 */
export class EventGraph {
  private readonly slots = new Map<string, number>()
  private readonly free: number[] = []
  private readonly released: number[] = []

  private deviceIds: (string | null)[] = []
  private locations: (Location | null)[] = []
  /** Where each device's own GPS puts it, in the field frame. Three per slot. */
  private anchorsBuffer = new Float64Array(INITIAL_CAPACITY * 3)

  /** Measured distances, `from` slot to `to` slot. Directed, as they arrive. */
  private readonly outgoing = new Map<number, Map<number, number>>()
  /** Who measured this slot — the reverse index a departure needs. */
  private readonly incoming = new Map<number, Set<number>>()

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
    return this.slots.get(deviceId)
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

  degreeOf(slot: number) {
    return this.outgoing.get(slot)?.size ?? 0
  }

  /** Every live slot, ascending. The order a keyframe goes out in. */
  *liveSlots() {
    for (let slot = 0; slot < this.deviceIds.length; slot++) {
      if (this.deviceIds[slot] !== null) yield slot
    }
  }

  applyBatch(ops: readonly IngestMessage[]) {
    for (const op of ops) this.apply(op)
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

  apply(op: IngestMessage) {
    switch (op.op) {
      case 'JOIN':
        this.place(op.deviceId, op.location)
        return

      case 'LOCATION_UPDATE':
        // Also an arrival, when the worker has never heard of this device. A
        // worker that starts mid-event missed every `JOIN` the crowd ever sent,
        // and phones report where they are anyway — so it fills in from the
        // reports instead of staying blind until everybody reconnects.
        this.place(op.deviceId, op.location)
        return

      case 'DISTANCE':
        this.setDistance(op.from, op.to, op.distance)
        return

      case 'LEAVE':
        this.remove(op.deviceId)
        return
    }
  }

  private place(deviceId: string, location: Location) {
    const slot = this.slots.get(deviceId) ?? this.claimSlot(deviceId)
    const anchor = projectLocation(location, this.origin)

    this.locations[slot] = location
    this.anchorsBuffer[slot * 3] = anchor.x
    this.anchorsBuffer[slot * 3 + 1] = anchor.y
    this.anchorsBuffer[slot * 3 + 2] = anchor.z
  }

  private claimSlot(deviceId: string) {
    const slot = this.free.pop() ?? this.deviceIds.length

    if (slot === this.deviceIds.length) {
      this.deviceIds.push(null)
      this.locations.push(null)
      this.grow(slot + 1)
    }

    this.deviceIds[slot] = deviceId
    this.slots.set(deviceId, slot)
    this.liveCount++

    return slot
  }

  private grow(needed: number) {
    if (needed * 3 <= this.anchorsBuffer.length) return

    const grown = new Float64Array(Math.max(needed, this.deviceIds.length * 2) * 3)
    grown.set(this.anchorsBuffer)
    this.anchorsBuffer = grown
  }

  /**
   * A distance whose endpoints the worker does not know yet is dropped rather
   * than buffered. Ranging is a sweep a device repeats, so the edge comes back
   * on its own once both ends have reported; holding it would mean keeping a
   * queue against an arrival that may never happen.
   */
  private setDistance(from: string, to: string, distance: number | null) {
    const fromSlot = this.slots.get(from)
    const toSlot = this.slots.get(to)

    if (fromSlot === undefined || toSlot === undefined) return
    if (fromSlot === toSlot) return

    if (distance === null) {
      this.dropEdge(fromSlot, toSlot)
      return
    }

    let neighbours = this.outgoing.get(fromSlot)

    if (!neighbours) {
      neighbours = new Map()
      this.outgoing.set(fromSlot, neighbours)
    }

    neighbours.set(toSlot, distance)

    let measuredBy = this.incoming.get(toSlot)

    if (!measuredBy) {
      measuredBy = new Set()
      this.incoming.set(toSlot, measuredBy)
    }

    measuredBy.add(fromSlot)
  }

  private dropEdge(fromSlot: number, toSlot: number) {
    this.outgoing.get(fromSlot)?.delete(toSlot)
    this.incoming.get(toSlot)?.delete(fromSlot)
  }

  private remove(deviceId: string) {
    const slot = this.slots.get(deviceId)
    if (slot === undefined) return

    // Both directions. The reverse index exists for exactly this: without it,
    // finding who measured a departing device is a scan of the whole graph.
    for (const to of this.outgoing.get(slot)?.keys() ?? []) {
      this.incoming.get(to)?.delete(slot)
    }

    for (const from of this.incoming.get(slot) ?? []) {
      this.outgoing.get(from)?.delete(slot)
    }

    this.outgoing.delete(slot)
    this.incoming.delete(slot)

    this.slots.delete(deviceId)
    this.deviceIds[slot] = null
    this.locations[slot] = null
    this.liveCount--

    // Handed to the next arrival. Whatever the solver left in the flat arrays at
    // this index is overwritten on the way in, never read on the way out.
    this.free.push(slot)
    this.released.push(slot)
  }
}
