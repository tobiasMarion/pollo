import type { Snapshot } from '../run/pool.js'
import { renderChart, type Series, SUBPIXELS } from './chart.js'
import type { SimulatorConfig } from './config.js'
import {
  formatDuration,
  formatMeters,
  formatRate,
  type Reporter,
  type ReportHeader,
} from './reporter.js'

const ALTERNATE_SCREEN_ON = '\u001b[?1049h'
const ALTERNATE_SCREEN_OFF = '\u001b[?1049l'
const HIDE_CURSOR = '\u001b[?25l'
const SHOW_CURSOR = '\u001b[?25h'
const HOME = '\u001b[H'
const CLEAR_BELOW = '\u001b[J'

const COLOR = {
  gps: '33',
  worker: '36',
  dim: '90',
  bold: '1',
} as const

/** Rows the header, stats and footer take, leaving the rest for the chart. */
const CHROME_ROWS = 12

function dim(text: string, colors: boolean) {
  return colors ? `\u001b[${COLOR.dim}m${text}\u001b[0m` : text
}

function bold(text: string, colors: boolean) {
  return colors ? `\u001b[${COLOR.bold}m${text}\u001b[0m` : text
}

/**
 * A fixed frame redrawn in place: header, the divergence chart, and the numbers
 * underneath it.
 *
 * Two lines are plotted, and the second one is the point. On its own the
 * worker's error says nothing — a number needs something to be better than. Raw
 * GPS, given exactly the same treatment, is the control: the gap between the
 * lines is what the worker is worth. Before a worker exists at all, only the
 * control is drawn, and that is still the answer to a real question.
 */
export function dashboardReporter(config: SimulatorConfig): Reporter {
  const output = process.stdout
  const colors = Boolean(output.isTTY) && process.env.NO_COLOR === undefined
  const interactive = Boolean(output.isTTY)

  let header: ReportHeader | null = null

  const gpsHistory: (number | null)[] = []
  const workerHistory: (number | null)[] = []

  const chartWidth = () => Math.max(20, Math.min(output.columns ?? 80, 160) - 12)
  const chartHeight = () => Math.max(6, Math.min(output.rows ?? 24, 40) - CHROME_ROWS)

  const push = (history: (number | null)[], value: number | null) => {
    history.push(value)

    const capacity = chartWidth() * SUBPIXELS.x
    if (history.length > capacity) history.splice(0, history.length - capacity)
  }

  return {
    start(incoming) {
      header = incoming

      if (interactive) output.write(ALTERNATE_SCREEN_ON + HIDE_CURSOR)
    },

    render(snapshot) {
      push(gpsHistory, snapshot.reporting === 0 ? null : snapshot.gps.aligned.rmse)
      push(workerHistory, snapshot.placed === 0 ? null : snapshot.worker.aligned.rmse)

      const series: Series[] = [
        { label: 'raw GPS', color: COLOR.gps, points: gpsHistory },
        { label: 'worker', color: COLOR.worker, points: workerHistory },
      ]

      const lines = [
        headerLine(header, snapshot, colors),
        '',
        ...renderChart(series, { width: chartWidth(), height: chartHeight(), colors }),
        '',
        ...statsBlock(snapshot, colors),
        '',
        dim(
          `throughput ${formatRate(snapshot.sentPerSecond)} out  ${formatRate(snapshot.receivedPerSecond)} in` +
            `   latency ${snapshot.latencyMs.toFixed(0)}ms   errors ${snapshot.errors}   reconnects ${snapshot.reconnects}`,
          colors,
        ),
        dim(config.duration ? '' : 'Ctrl-C to stop', colors),
      ]

      // One write per frame. Drawing piecemeal is what makes a redrawing
      // terminal UI tear and flicker.
      output.write(interactive ? HOME + lines.join('\n') + CLEAR_BELOW : `${lines.join('\n')}\n`)
    },

    stop() {
      if (interactive) output.write(SHOW_CURSOR + ALTERNATE_SCREEN_OFF)
    },
  }
}

function headerLine(header: ReportHeader | null, snapshot: Snapshot, colors: boolean) {
  if (!header) return ''

  const coverage =
    snapshot.reporting === 0 ? 0 : Math.round((snapshot.placed / snapshot.reporting) * 100)

  return [
    bold(header.eventName, colors),
    dim('·', colors),
    `${snapshot.connected}/${header.clients} online`,
    dim('·', colors),
    `${coverage}% placed`,
    dim('·', colors),
    formatDuration(snapshot.elapsedSeconds),
    dim(`· seed ${header.seed} · ${header.shards} shards`, colors),
  ].join(' ')
}

/**
 * Aligned first, because it is the honest number: a reconstruction from
 * distances has no idea which way north is, so the raw figure next to it is
 * mostly a report of that ambiguity.
 */
function statsBlock(snapshot: Snapshot, colors: boolean) {
  const row = (label: string, comparison: Snapshot['gps'], present: boolean) => {
    if (!present) return `  ${label.padEnd(9)}${dim('waiting', colors)}`

    return [
      `  ${label.padEnd(9)}`,
      `aligned ${formatMeters(comparison.aligned.rmse).padStart(7)}`,
      dim(`  p50 ${formatMeters(comparison.aligned.p50)}`, colors),
      dim(`  p95 ${formatMeters(comparison.aligned.p95)}`, colors),
      dim(`  max ${formatMeters(comparison.aligned.max)}`, colors),
      dim(`  raw ${formatMeters(comparison.raw.rmse)}`, colors),
    ].join('')
  }

  return [
    dim('  RMSE against ground truth', colors),
    row('raw GPS', snapshot.gps, snapshot.reporting > 0),
    row('worker', snapshot.worker, snapshot.placed > 0),
  ]
}
