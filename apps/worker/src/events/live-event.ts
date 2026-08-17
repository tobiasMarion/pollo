import type { IngestBatch, Origin, PositionPoint } from '@pollo/contracts'
import { EventGraph } from '../ingest/graph.js'
import { PublishLedger } from '../publish/ledger.js'
import { positionOf } from '../publish/position.js'
import type { PositionPublisher } from '../redis/publisher.js'
import { Solver, type SolverOptions } from '../solve/solver.js'

export interface LiveEventOptions {
  eventId: string
  origin: Origin
  publisher: PositionPublisher
  keyframeTicks: number
  epsilon: number
  minDegree: number
  solver: SolverOptions
}

/**
 * One event being solved.
 *
 * Ingest and solve are deliberately not the same clock. Batches land whenever
 * the API cuts a window; the tick decides how much work the current graph gets
 * before the answer goes out. Coupling them would tie how hard the worker
 * thinks to how often the crowd speaks, which are unrelated questions.
 */
export class LiveEvent {
  private readonly graph: EventGraph
  private readonly ledger: PublishLedger
  private readonly solver: Solver
  private ticksSinceKeyframe = Number.POSITIVE_INFINITY
  private correcting = true

  constructor(private readonly options: LiveEventOptions) {
    this.graph = new EventGraph(options.origin)
    this.ledger = new PublishLedger(options.epsilon)
    this.solver = new Solver(options.solver)
  }

  get eventId() {
    return this.options.eventId
  }

  get size() {
    return this.graph.size
  }

  ingest(batch: IngestBatch) {
    this.graph.applyBatch(batch.ops)

    for (const slot of this.graph.drainReleased()) this.ledger.forget(slot)
  }

  /**
   * Stops correcting without stopping.
   *
   * Ingest and the solve carry on underneath, so turning it back on costs
   * nothing — what changes is only what gets published. See `dev/toggle.ts` for
   * why this exists and why it never runs in production.
   */
  setCorrecting(correcting: boolean) {
    if (correcting === this.correcting) return

    this.correcting = correcting

    // Say so at once and in full, rather than letting the change trickle out one
    // delta at a time as devices happen to move.
    this.ticksSinceKeyframe = Number.POSITIVE_INFINITY
  }

  get isCorrecting() {
    return this.correcting
  }

  tick() {
    this.solver.sync(this.graph)
    this.solver.advance(this.graph)

    const keyframe = this.ticksSinceKeyframe >= this.options.keyframeTicks
    const points: PositionPoint[] = []

    for (const slot of this.graph.liveSlots()) {
      const deviceId = this.graph.deviceAt(slot)
      const location = this.graph.locationAt(slot)

      if (deviceId === undefined || location === undefined) continue

      const estimate = this.estimate(slot)

      // Nothing to publish for a device the reconstruction has no opinion about.
      // Its own GPS is not an estimate, and dressing one up as the other is what
      // the panel's outline-against-pixel distinction exists to prevent.
      if (!estimate) continue

      if (!keyframe && !this.ledger.changed(slot, estimate.x, estimate.y, estimate.z)) continue

      this.ledger.record(slot, estimate.x, estimate.y, estimate.z)
      points.push(positionOf(deviceId, location, estimate, this.options.origin))
    }

    // The tick being emitted counts as the first of its cycle, so `keyframeTicks`
    // is the period rather than one less than it.
    this.ticksSinceKeyframe = keyframe ? 1 : this.ticksSinceKeyframe + 1

    this.options.publisher.publish(this.eventId, keyframe ? 'keyframe' : 'delta', points)
  }

  /**
   * Where the worker thinks a device is, or nothing if it will not say.
   *
   * The degree is the solver's rather than the graph's: the graph counts what a
   * device measured, and what holds a device in place is every distance that
   * names it, whichever end reported it. A phone that ranged nobody and was
   * ranged by six is well held.
   *
   * Below the threshold there is no answer to give. Such a device is held by its
   * own GPS and almost nothing else, so publishing it would be handing the
   * measurement back as though it were an estimate — and the panel draws an
   * unplaced device as an outline precisely so that difference stays visible.
   *
   * Switched off, every device is published at its own GPS instead. Not silence:
   * silence would leave the last good answer on screen and look like nothing
   * happened, where the point is to watch the crowd come apart into the cloud it
   * would have been without any of this.
   */
  private estimate(slot: number) {
    if (!this.correcting) return this.graph.anchorAt(slot)
    if (this.solver.degreeOf(slot) < this.options.minDegree) return undefined

    return this.solver.at(slot)
  }
}
