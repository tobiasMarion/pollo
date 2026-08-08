import type { Snapshot } from '../run/pool.js'
import type { SimulatorConfig } from './config.js'

export interface Reporter {
  start(header: ReportHeader): void
  render(snapshot: Snapshot): void
  stop(): void
}

export interface ReportHeader {
  eventName: string
  eventId: string
  venue: string
  clients: number
  seed: number
  shards: number
}

/**
 * One line of NDJSON per sample. What CI and anything that wants to plot the
 * run afterwards consume — a dashboard that redraws in place is unreadable in a
 * log file.
 */
export function jsonReporter(): Reporter {
  return {
    start(header) {
      console.log(JSON.stringify({ event: 'start', ...header }))
    },
    render(snapshot) {
      console.log(JSON.stringify({ event: 'sample', ...snapshot }))
    },
    stop() {
      console.log(JSON.stringify({ event: 'stop' }))
    },
  }
}

export function formatMeters(value: number) {
  if (!Number.isFinite(value)) return '   —  '
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}km`

  return `${value.toFixed(1)}m`
}

export function formatRate(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M/s`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k/s`

  return `${value.toFixed(0)}/s`
}

export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)

  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * A scrolling line per sample. Survives being piped, redirected or run where
 * nothing owns a terminal, which the full dashboard does not.
 */
export function plainReporter(config: SimulatorConfig): Reporter {
  return {
    start(header) {
      console.log(
        `${header.eventName} — ${header.clients} phones in a ${header.venue} over ${header.shards} shards, seed ${header.seed}`,
      )
      console.log('  time  online  placed   worker(aligned)   gps(aligned)   sent    latency')
    },
    render(snapshot) {
      const worker =
        snapshot.placed === 0
          ? '     —     '
          : formatMeters(snapshot.worker.aligned.rmse).padStart(11)

      console.log(
        [
          formatDuration(snapshot.elapsedSeconds).padStart(6),
          String(snapshot.connected).padStart(7),
          String(snapshot.placed).padStart(7),
          worker,
          formatMeters(snapshot.gps.aligned.rmse).padStart(14),
          formatRate(snapshot.sentPerSecond).padStart(8),
          `${snapshot.latencyMs.toFixed(0)}ms`.padStart(9),
        ].join(''),
      )
    },
    stop() {
      console.log(`done — ${config.clients} clients`)
    },
  }
}
