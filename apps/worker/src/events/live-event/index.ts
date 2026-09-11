import type { IngestBatch, PositionPoint } from '@pollo/contracts'
import type { Origin } from '@pollo/geometry'
import type { EventGraph } from '../../ingest/graph/index.js'
import type { PublishLedger } from '../../publish/ledger/index.js'
import { positionOf } from '../../publish/position/index.js'
import type { Solver } from '../../solve/solver/index.js'

export interface LiveEventOptions {
  eventId: string
  origin: Origin
  keyframeTicks: number
  minDegree: number
}

/** Assembled once per event, by the composition root. */
export interface LiveEventDependencies {
  graph: EventGraph
  ledger: PublishLedger
  solver: Solver
  publisher: PositionSink
}

export interface PositionSink {
  publish(eventId: string, kind: 'delta' | 'keyframe', points: readonly PositionPoint[]): void
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
  private ticksSinceKeyframe = Number.POSITIVE_INFINITY
  private correcting = true

  constructor(
    private readonly deps: LiveEventDependencies,
    private readonly options: LiveEventOptions,
  ) {}

  get eventId() {
    return this.options.eventId
  }

  get size() {
    return this.deps.graph.size
  }

  ingest(batch: IngestBatch) {
    this.deps.graph.applyBatch(batch.ops)

    for (const slot of this.deps.graph.drainReleased()) this.deps.ledger.forget(slot)
  }

  /**
   * Stops correcting without stopping.
   *
   * Ingest and the solve carry on underneath, so turning it back on costs
   * nothing — what changes is only what gets published. It exists so the panel
   * can be shown the crowd coming apart into the cloud it would have been
   * without any of this, side by side with the reconstruction.
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
    const { graph, solver, ledger, publisher } = this.deps

    solver.sync(graph)
    solver.advance(graph)

    const keyframe = this.ticksSinceKeyframe >= this.options.keyframeTicks
    const points: PositionPoint[] = []

    for (const slot of graph.liveSlots()) {
      const deviceId = graph.deviceAt(slot)
      const location = graph.locationAt(slot)

      if (deviceId === undefined || location === undefined) continue

      const estimate = this.estimate(slot)

      // Nothing to publish for a device the reconstruction has no opinion about.
      // Its own GPS is not an estimate, and dressing one up as the other is what
      // the panel's outline-against-pixel distinction exists to prevent.
      if (!estimate) continue

      if (!keyframe && !ledger.changed(slot, estimate.x, estimate.y, estimate.z)) continue

      ledger.record(slot, estimate.x, estimate.y, estimate.z)
      points.push(positionOf(deviceId, location, estimate, this.options.origin))
    }

    // The tick being emitted counts as the first of its cycle, so `keyframeTicks`
    // is the period rather than one less than it.
    this.ticksSinceKeyframe = keyframe ? 1 : this.ticksSinceKeyframe + 1

    publisher.publish(this.eventId, keyframe ? 'keyframe' : 'delta', points)
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
   * happened, where the point is to watch the crowd come apart.
   */
  private estimate(slot: number) {
    if (!this.correcting) return this.deps.graph.anchorAt(slot)
    if (this.deps.solver.degreeOf(slot) < this.options.minDegree) return undefined

    return this.deps.solver.at(slot)
  }
}
