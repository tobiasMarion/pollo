import { Worker } from 'node:worker_threads'
import type { Origin } from '@pollo/contracts'
import type { SimulatorConfig } from '../io/config.js'
import { type CloudComparison, compareClouds, EMPTY_COMPARISON } from '../metrics/error.js'
import type { ShardData } from './shard.js'
import {
  attach,
  COUNTER,
  createSharedBuffers,
  DEVICE,
  drain,
  read,
  SETTING,
  type SharedState,
  write,
} from './shared.js'

export interface Snapshot {
  elapsedSeconds: number
  connected: number
  /** Devices the worker has placed at least once. */
  placed: number
  /** Devices that have reported a fix — the control line's population. */
  reporting: number
  /** How the worker's cloud compares with the truth. */
  worker: CloudComparison
  /** How raw GPS compares with the truth, given identical treatment. */
  gps: CloudComparison
  sentPerSecond: number
  receivedPerSecond: number
  errors: number
  reconnects: number
  /** Mean `LOCATION_UPDATE` to `SET_POINT` round trip, in ms. */
  latencyMs: number
  /** Whether the sensors are lying, which the operator can switch mid-run. */
  noise: boolean
}

export const EMPTY_SNAPSHOT: Snapshot = {
  elapsedSeconds: 0,
  connected: 0,
  placed: 0,
  reporting: 0,
  worker: EMPTY_COMPARISON,
  gps: EMPTY_COMPARISON,
  sentPerSecond: 0,
  receivedPerSecond: 0,
  errors: 0,
  reconnects: 0,
  latencyMs: 0,
  noise: true,
}

/**
 * Owns the shards and turns what they write into the numbers the dashboard
 * draws.
 */
export class SimulationPool {
  private readonly workers: Worker[] = []
  private readonly shared: SharedState
  private readonly epoch = Date.now()

  private lastSampledAt = Date.now()

  /** Compacted copies of the crowd, reused so a 2 Hz scan allocates nothing. */
  private readonly truthOf: Float32Array
  private readonly estimateOf: Float32Array
  private readonly reportedOf: Float32Array
  private readonly truthOfReporting: Float32Array

  constructor(
    private readonly config: SimulatorConfig,
    url: string,
    origin: Origin,
  ) {
    const buffers = createSharedBuffers(config.clients)
    this.shared = attach(buffers, config.clients)

    // A `SharedArrayBuffer` starts zeroed, and zero here would mean a run that
    // begins with every sensor telling the truth.
    write(this.shared.settings, SETTING.NOISE, 1)

    const size = config.clients * 3
    this.truthOf = new Float32Array(size)
    this.estimateOf = new Float32Array(size)
    this.reportedOf = new Float32Array(size)
    this.truthOfReporting = new Float32Array(size)

    const shards = Math.min(config.threads, config.clients)
    const perShard = Math.ceil(config.clients / shards)

    for (let ordinal = 0; ordinal < shards; ordinal++) {
      const from = ordinal * perShard
      const to = Math.min(config.clients, from + perShard)
      if (from >= to) break

      const data: ShardData = {
        buffers,
        config,
        url,
        origin,
        from,
        to,
        ordinal,
        shards,
        epoch: this.epoch,
      }

      this.workers.push(
        new Worker(new URL('./shard-entry.mjs', import.meta.url), { workerData: data }),
      )
    }
  }

  /**
   * Switch the sensor noise off, or back on, without stopping the run.
   *
   * The point is the comparison. Every number on the dashboard is a claim about
   * how much the noise costs, and the only way to read that claim is to remove
   * the noise and watch what happens to it — with the same crowd, the same
   * seats and the same sockets, mid-flight.
   */
  setNoise(enabled: boolean) {
    write(this.shared.settings, SETTING.NOISE, enabled ? 1 : 0)
  }

  get noise() {
    return read(this.shared.settings, SETTING.NOISE) === 1
  }

  onShardError(handler: (error: Error) => void) {
    for (const worker of this.workers) worker.on('error', handler)
  }

  /**
   * Gathered separately because the populations differ, which is the point
   * rather than a caveat: raw GPS is scored over every device that has ever
   * reported a fix, and the worker over the ones it has managed to place.
   */
  sample(): Snapshot {
    const now = Date.now()
    const { flags, truth, estimate, reported, counters } = this.shared

    let placed = 0
    let reporting = 0

    for (let index = 0; index < this.config.clients; index++) {
      const flag = flags[index] ?? 0

      if (flag & DEVICE.PLACED) {
        copyVector(estimate, index, this.estimateOf, placed)
        copyVector(truth, index, this.truthOf, placed)
        placed++
      }

      if (flag & DEVICE.REPORTED) {
        copyVector(reported, index, this.reportedOf, reporting)
        copyVector(truth, index, this.truthOfReporting, reporting)
        reporting++
      }
    }

    const seconds = Math.max(0.001, (now - this.lastSampledAt) / 1_000)
    this.lastSampledAt = now

    const latencySamples = drain(counters, COUNTER.LATENCY_SAMPLES)
    const latencySum = drain(counters, COUNTER.LATENCY_SUM_MS)

    return {
      elapsedSeconds: (now - this.epoch) / 1_000,
      connected: Math.max(0, read(counters, COUNTER.CONNECTED)),
      placed,
      reporting,
      worker: compareClouds(this.estimateOf, this.truthOf, placed),
      gps: compareClouds(this.reportedOf, this.truthOfReporting, reporting),
      sentPerSecond: drain(counters, COUNTER.SENT) / seconds,
      receivedPerSecond: drain(counters, COUNTER.RECEIVED) / seconds,
      errors: read(counters, COUNTER.ERRORS),
      reconnects: read(counters, COUNTER.RECONNECTS),
      latencyMs: latencySamples === 0 ? 0 : latencySum / latencySamples,
      noise: this.noise,
    }
  }

  async stop() {
    await Promise.all(
      this.workers.map(
        worker =>
          new Promise<void>(resolve => {
            const done = () => {
              void worker.terminate()
              resolve()
            }

            // `once` would be wrong: a shard's `ready` can still be in flight,
            // and consuming that leaves the real acknowledgement unlistened.
            worker.on('message', (message: { type?: string }) => {
              if (message?.type === 'stopped') done()
            })

            // The run is over; waiting on a wedged thread helps nobody.
            setTimeout(done, 2_000).unref()
            worker.postMessage({ type: 'stop' })
          }),
      ),
    )
  }
}

function copyVector(from: Float32Array, at: number, to: Float32Array, slot: number) {
  to[slot * 3] = from[at * 3] ?? 0
  to[slot * 3 + 1] = from[at * 3 + 1] ?? 0
  to[slot * 3 + 2] = from[at * 3 + 2] ?? 0
}
