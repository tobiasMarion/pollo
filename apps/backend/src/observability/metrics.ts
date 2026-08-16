import { monitorEventLoopDelay } from 'node:perf_hooks'

const NANOS_PER_MS = 1e6

/** A distribution too small to deserve a histogram: how many, how much, how bad. */
export interface Summary {
  count: number
  total: number
  max: number
  mean: number
}

export interface MetricsSnapshot {
  /** Milliseconds the counts below were accumulated over. */
  window: number
  /** Raw totals for the window. */
  counters: Record<string, number>
  /** The same totals per second, which is the form anybody actually reads. */
  rates: Record<string, number>
  summaries: Record<string, Summary>
  gauges: Record<string, number>
  /** Milliseconds the loop was late by, which is the tell for saturation. */
  eventLoop: { mean: number; p50: number; p99: number; max: number }
}

/**
 * Counters, small summaries and gauges, cut into a report on a fixed cadence.
 *
 * An API over its limit answers every request and logs no errors — it just
 * falls further behind. All of that is a number and none of it throws.
 */
export class Metrics {
  private counters = new Map<string, number>()
  private summaries = new Map<string, Summary>()
  private readonly gauges = new Map<string, () => number>()

  private readonly loopDelay = monitorEventLoopDelay({ resolution: 10 })

  private cutAt: number
  private last: MetricsSnapshot | null = null

  /** `now` is when the first window opens; only a test ever needs to say. */
  constructor(now = Date.now()) {
    this.cutAt = now
    this.loopDelay.enable()
  }

  count(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by)
  }

  /** Records one observation of something with a size or a duration. */
  observe(name: string, value: number) {
    const summary = this.summaries.get(name)

    if (!summary) {
      this.summaries.set(name, { count: 1, total: value, max: value, mean: value })
      return
    }

    summary.count++
    summary.total += value
    summary.max = Math.max(summary.max, value)
    summary.mean = summary.total / summary.count
  }

  /**
   * A value read at the cut rather than kept in step. Connections and queued
   * work change far more often than anybody looks at them.
   */
  gauge(name: string, read: () => number) {
    this.gauges.set(name, read)
  }

  /** The last report that was cut, for a reader that must not disturb the window. */
  latest() {
    return this.last
  }

  /** Cuts a report and starts a new window. Gauges survive; counts do not. */
  take(now = Date.now()): MetricsSnapshot {
    const window = Math.max(1, now - this.cutAt)
    const seconds = window / 1_000

    const counters: Record<string, number> = {}
    const rates: Record<string, number> = {}

    for (const [name, total] of this.counters) {
      counters[name] = total
      rates[name] = Math.round(total / seconds)
    }

    const snapshot: MetricsSnapshot = {
      window,
      counters,
      rates,
      summaries: Object.fromEntries(this.summaries),
      gauges: Object.fromEntries([...this.gauges].map(([name, read]) => [name, read()])),
      eventLoop: {
        mean: round(this.loopDelay.mean / NANOS_PER_MS),
        p50: round(this.loopDelay.percentile(50) / NANOS_PER_MS),
        p99: round(this.loopDelay.percentile(99) / NANOS_PER_MS),
        max: round(this.loopDelay.max / NANOS_PER_MS),
      },
    }

    this.counters = new Map()
    this.summaries = new Map()
    this.loopDelay.reset()
    this.cutAt = now
    this.last = snapshot

    return snapshot
  }

  stop() {
    this.loopDelay.disable()
  }
}

/** Whether a window is worth writing down. Nothing happened is not news. */
export function isQuiet(snapshot: MetricsSnapshot) {
  return (
    Object.keys(snapshot.counters).length === 0 &&
    Object.values(snapshot.gauges).every(value => value === 0)
  )
}

function round(milliseconds: number) {
  return Number.isFinite(milliseconds) ? Math.round(milliseconds * 100) / 100 : 0
}
