import { EMPTY_SNAPSHOT, type FieldSource, type Snapshot } from '../run/pool.js'
import { renderChart, type Series, SUBPIXELS } from './chart.js'
import type { SimulatorConfig } from './config.js'
import { createFieldView } from './field.js'
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

/** The same, for the field view — no axis labels, no legend, one line of stats. */
const FIELD_CHROME_ROWS = 6

function dim(text: string, colors: boolean) {
  return colors ? `\u001b[${COLOR.dim}m${text}\u001b[0m` : text
}

function bold(text: string, colors: boolean) {
  return colors ? `\u001b[${COLOR.bold}m${text}\u001b[0m` : text
}

/**
 * A fixed frame redrawn in place, in either of two readings of the same run.
 *
 * The **chart** plots two lines, and the second one is the point. On its own the
 * worker's error says nothing — a number needs something to be better than. Raw
 * GPS, given exactly the same treatment, is the control: the gap between the
 * lines is what the worker is worth. Before a worker exists at all, only the
 * control is drawn, and that is still the answer to a real question.
 *
 * The **field** answers a question the chart cannot be asked. An RMSE is one
 * number over the whole crowd, and the same number covers error spread thinly
 * across everybody and error piled onto one corner — which are not the same show.
 * Drawing the crowd where it really is and lighting it from where the worker
 * thinks it is turns that difference back into something with a shape.
 */
export function dashboardReporter(config: SimulatorConfig, source: FieldSource): Reporter {
  const output = process.stdout
  const colors = Boolean(output.isTTY) && process.env.NO_COLOR === undefined
  const interactive = Boolean(output.isTTY)

  let header: ReportHeader | null = null
  let view = config.view

  // Kept so a redraw between samples has something to put in the chrome. The
  // field itself is read live; these are the numbers around it.
  let latest: Snapshot = EMPTY_SNAPSHOT

  const gpsHistory: (number | null)[] = []
  const workerHistory: (number | null)[] = []
  const fieldView = createFieldView()

  const plotWidth = () => Math.max(20, Math.min(output.columns ?? 80, 160) - 12)
  const chartHeight = () => Math.max(6, Math.min(output.rows ?? 24, 40) - CHROME_ROWS)
  const fieldHeight = () => Math.max(6, Math.min(output.rows ?? 24, 48) - FIELD_CHROME_ROWS)

  const push = (history: (number | null)[], value: number | null) => {
    history.push(value)

    const capacity = plotWidth() * SUBPIXELS.x
    if (history.length > capacity) history.splice(0, history.length - capacity)
  }

  const draw = () => {
    const lines = view === 'chart' ? chartFrame() : fieldFrame()

    // One write per frame. Drawing piecemeal is what makes a redrawing
    // terminal UI tear and flicker.
    output.write(interactive ? HOME + lines.join('\n') + CLEAR_BELOW : `${lines.join('\n')}\n`)
  }

  const chartFrame = () => {
    const series: Series[] = [
      { label: 'raw GPS', color: COLOR.gps, points: gpsHistory },
      { label: 'worker', color: COLOR.worker, points: workerHistory },
    ]

    return [
      headerLine(header, latest, colors),
      '',
      ...renderChart(series, { width: plotWidth(), height: chartHeight(), colors }),
      '',
      ...statsBlock(latest, colors),
      '',
      dim(
        `throughput ${formatRate(latest.sentPerSecond)} out  ${formatRate(latest.receivedPerSecond)} in` +
          `   latency ${latest.latencyMs.toFixed(0)}ms   errors ${latest.errors}   reconnects ${latest.reconnects}`,
        colors,
      ),
      footer('V for the field', latest),
    ]
  }

  const fieldFrame = () => {
    const width = Math.max(20, Math.min(output.columns ?? 80, 200))

    return [
      headerLine(header, latest, colors),
      '',
      ...fieldView.render(source, { width, height: fieldHeight(), colors, now: Date.now() }),
      '',
      // Spelled out on the screen, because a viewer who reads this as the panel
      // would blame the wrong component for everything they are looking at.
      [
        `${dim('position', colors)} ground truth`,
        `${dim('brightness', colors)} worker estimate`,
        `${dim('cue', colors)} ${source.cue?.effect.name.toLowerCase() ?? '—'}`,
      ].join('   '),
      footer('V for the chart', latest),
    ]
  }

  const footer = (toggle: string, snapshot: Snapshot) =>
    dim(
      `${toggle}   space ${snapshot.noise ? 'silences the sensors' : 'lets the sensors lie again'}` +
        (config.duration ? '' : '   Ctrl-C to stop'),
      colors,
    )

  return {
    start(incoming) {
      header = incoming

      if (interactive) output.write(ALTERNATE_SCREEN_ON + HIDE_CURSOR)
    },

    render(snapshot) {
      latest = snapshot

      push(gpsHistory, snapshot.reporting === 0 ? null : snapshot.gps.aligned.rmse)
      push(workerHistory, snapshot.placed === 0 ? null : snapshot.worker.aligned.rmse)

      draw()
    },

    redraw() {
      // The chart only changes when a sample arrives, so redrawing it between
      // samples is a screenful of writes that produces the identical screen.
      if (view === 'field') draw()
    },

    key(key) {
      if (key !== 'v' && key !== 'V') return

      view = view === 'chart' ? 'field' : 'chart'
      draw()
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
    dim(`· ${header.venue} · seed ${header.seed} · ${header.shards} shards`, colors),
    // Loud, because it changes what every other number on the screen means.
    snapshot.noise ? '' : bold('· NOISE OFF', colors),
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
