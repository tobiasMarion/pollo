import type { EventGraph, Location } from '@pollo/contracts'
import type { FastifyBaseLogger } from 'fastify'
import type { Metrics } from '../../observability/metrics.js'
import type { Bus } from '../redis/bus.js'
import { type GraphBatch, GraphWriter, ingestOpsOf, WRITE_INTERVAL_MS } from './graph-writer.js'

export interface GraphStorage {
  applyBatch(batch: GraphBatch): Promise<void>
  getEventGraph(): Promise<EventGraph>
  deleteGraph(): Promise<void>
}

/** Persists one live graph and publishes the same ordered windows to the worker. */
export class GraphRuntime {
  private readonly writer = new GraphWriter()
  private retryBatch: GraphBatch | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private flushing: Promise<void> | null = null

  constructor(
    private readonly eventId: string,
    private readonly storage: GraphStorage,
    private readonly bus: Bus,
    private readonly logger?: FastifyBaseLogger,
    private readonly metrics?: Metrics,
  ) {}

  get pending() {
    return this.writer.pending + (this.retryBatch ? ingestOpsOf(this.retryBatch).length : 0)
  }

  joined(deviceId: string, location: Location) {
    this.writer.joined(deviceId, location)
    this.schedule()
  }

  moved(deviceId: string, location: Location) {
    this.writer.locationChanged(deviceId, location)
    this.schedule()
  }

  measured(from: string, to: string, distance: number | null) {
    this.writer.edgeChanged(from, to, distance)
    this.schedule()
  }

  departed(deviceId: string) {
    this.writer.departed(deviceId)
    this.schedule()
  }

  snapshot() {
    return this.storage.getEventGraph()
  }

  /** Resolves after the oldest outstanding window has had a chance to land. */
  async settle() {
    await this.flushing

    if (!this.writer.empty || this.retryBatch) await this.flush()
  }

  /** Stops accepting history and removes the durable graph. */
  async discard() {
    this.stop()
    this.writer.discard()

    await this.flushing
    this.retryBatch = null
    await this.storage.deleteGraph()
  }

  /** Flushes process-owned state without deleting the recovery snapshot. */
  async shutdown() {
    this.stop()
    await this.settle()
  }

  private schedule() {
    if (this.timer) return

    this.timer = setInterval(() => void this.flush(), WRITE_INTERVAL_MS)
    this.timer.unref?.()
  }

  private stop() {
    if (!this.timer) return

    clearInterval(this.timer)
    this.timer = null
  }

  /** Keeps a failed window at the head, so a later one can never pass it. */
  private async flush(): Promise<void> {
    if (this.flushing) return await this.flushing

    if (this.writer.empty && !this.retryBatch) {
      this.stop()
      return
    }

    const batch = this.retryBatch ?? this.writer.take()
    const startedAt = Date.now()

    this.flushing = this.storage
      .applyBatch(batch)
      // State first, delta second. Recovery sees the window in one or the other.
      .then(() => this.bus.publishIngest(this.eventId, { at: startedAt, ops: ingestOpsOf(batch) }))
      .then(() => {
        this.retryBatch = null
        this.metrics?.observe('storeFlushMs', Date.now() - startedAt)
      })
      .catch(error => {
        this.retryBatch = batch
        this.logger?.error({ err: error }, 'graph window failed; retrying')
      })
      .finally(() => {
        this.flushing = null
      })

    await this.flushing
  }
}
