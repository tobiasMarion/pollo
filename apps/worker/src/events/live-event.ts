import type { IngestBatch, Origin, PositionPoint } from '@pollo/contracts'
import { EventGraph } from '../ingest/graph.js'
import { PublishLedger } from '../publish/ledger.js'
import { positionOf } from '../publish/position.js'
import type { PositionPublisher } from '../redis/publisher.js'

export interface LiveEventOptions {
  eventId: string
  origin: Origin
  publisher: PositionPublisher
  keyframeTicks: number
  epsilon: number
}

/**
 * One event being solved.
 *
 * Ingest and solve are deliberately not the same clock. Batches land whenever
 * the API cuts a window; the tick decides how much work the current graph gets
 * before the answer goes out. Coupling them would tie how hard the worker
 * thinks to how often the crowd speaks, which are unrelated questions.
 *
 * There is no solver here yet — `estimate` returns each device's own GPS. That
 * makes the whole path real (stream in, positions out, pixels drawn) while the
 * numbers are still the control, so the reconstruction that replaces it is
 * measured against a line rather than against nothing.
 */
export class LiveEvent {
  private readonly graph: EventGraph
  private readonly ledger: PublishLedger
  private ticksSinceKeyframe = Number.POSITIVE_INFINITY

  constructor(private readonly options: LiveEventOptions) {
    this.graph = new EventGraph(options.origin)
    this.ledger = new PublishLedger(options.epsilon)
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

  tick() {
    const keyframe = this.ticksSinceKeyframe >= this.options.keyframeTicks
    const points: PositionPoint[] = []

    for (const slot of this.graph.liveSlots()) {
      const deviceId = this.graph.deviceAt(slot)
      const location = this.graph.locationAt(slot)

      if (deviceId === undefined || location === undefined) continue

      const estimate = this.estimate(slot)

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
   * Where the worker thinks a device is. Today: where its GPS says it is.
   *
   * When the solver lands this is the one method that changes.
   */
  private estimate(slot: number) {
    return this.graph.anchorAt(slot)
  }
}
