import type { IngestMessage, Location } from '@pollo/contracts'
import type { EdgeSource, Origin } from '@pollo/geometry'
import { EdgeTable } from '../edges/index.js'
import { SlotTable } from '../slots/index.js'

/**
 * One event's graph, as the worker holds it: who is here, what they measured,
 * and one version number covering both.
 *
 * The two tables underneath are the representation, not collaborators — nothing
 * would ever want a different slot table. What this class adds is the part that
 * is a decision rather than a data structure: what counts as shape, and what
 * counts as a device having learned something.
 *
 * It satisfies `EdgeSource`, which is all `@pollo/geometry` asks of it.
 */
export class EventGraph implements EdgeSource {
  private readonly slots: SlotTable
  private readonly edges = new EdgeTable()

  private shape = 0
  private readonly touched = new Set<number>()

  constructor(origin: Origin) {
    this.slots = new SlotTable(origin)
  }

  get origin() {
    return this.slots.origin
  }

  get size() {
    return this.slots.size
  }

  /**
   * Bumped whenever the set of edges changes, so a solver holding a compiled
   * copy of the graph knows to rebuild it — and, far more often, knows not to.
   */
  get version() {
    return this.shape
  }

  get edgeCount() {
    return this.edges.count
  }

  get capacity() {
    return this.slots.capacity
  }

  get anchors() {
    return this.slots.anchors
  }

  slotOf(deviceId: string) {
    return this.slots.slotOf(deviceId)
  }

  deviceAt(slot: number) {
    return this.slots.deviceAt(slot)
  }

  locationAt(slot: number) {
    return this.slots.locationAt(slot)
  }

  anchorAt(slot: number) {
    return this.slots.anchorAt(slot)
  }

  degreeOf(slot: number) {
    return this.edges.degreeOf(slot)
  }

  liveSlots() {
    return this.slots.liveSlots()
  }

  drainReleased() {
    return this.slots.drainReleased()
  }

  forEachEdge(visit: (from: number, to: number, distance: number) => void) {
    this.edges.forEachEdge(visit)
  }

  /**
   * Slots that learned something since the last call — a new fix, or an edge
   * appearing or going away.
   *
   * This is what "evidence" means to the solver. A device that has stopped
   * reporting stops appearing here and stops maturing, which is the difference
   * between counting what a node has been told and counting how long it has
   * been sitting there.
   */
  drainTouched() {
    const touched = [...this.touched]

    this.touched.clear()

    return touched
  }

  applyBatch(ops: readonly IngestMessage[]) {
    for (const op of ops) this.apply(op)
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
    const { slot, arrived } = this.slots.place(deviceId, location)

    // Membership counts as shape. One version covers "who is here" and "what is
    // measured" together, so anything holding a compiled copy has one thing to
    // compare rather than two that can disagree.
    if (arrived) this.shape++

    this.touched.add(slot)
  }

  /**
   * A distance whose endpoints the worker does not know yet is dropped rather
   * than buffered. Ranging is a sweep a device repeats, so the edge comes back
   * on its own once both ends have reported; holding it would mean keeping a
   * queue against an arrival that may never happen.
   */
  private setDistance(from: string, to: string, distance: number | null) {
    const fromSlot = this.slots.slotOf(from)
    const toSlot = this.slots.slotOf(to)

    if (fromSlot === undefined || toSlot === undefined) return
    if (fromSlot === toSlot) return

    if (distance === null) {
      if (this.edges.drop(fromSlot, toSlot)) this.shape++
    } else {
      // The version moves for any write at all, because a compiled copy holds
      // the distances as well as the shape, and a re-measured pair is a
      // different constraint.
      this.edges.set(fromSlot, toSlot, distance)
      this.shape++
    }

    this.touched.add(fromSlot)
    this.touched.add(toSlot)
  }

  private remove(deviceId: string) {
    const slot = this.slots.slotOf(deviceId)

    if (slot === undefined) return

    for (const affected of this.edges.removeSlot(slot)) this.touched.add(affected)

    this.shape++
    this.touched.delete(slot)
    this.slots.release(deviceId)
  }
}
