/**
 * Bit each dot contributes to a braille cell, by row then column. The block
 * starts at U+2800 and every pattern is that base plus the bits that are lit,
 * which is what buys four vertical samples per character row — a line chart in
 * a terminal reads as a line rather than a staircase.
 */
const DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

const BRAILLE_BASE = 0x2800

export const SUBPIXELS = { x: 2, y: 4 } as const

export interface Series {
  label: string
  /** ANSI colour code, e.g. '36' for cyan. */
  color: string
  /** Oldest first. `null` marks a sample the series had no value for. */
  points: readonly (number | null)[]
}

export interface ChartOptions {
  /** Width and height of the plot area, in terminal cells. */
  width: number
  height: number
  /** Rendered next to the axis labels. */
  unit?: string
  colors: boolean
}

/**
 * One braille grid per series, so each can be coloured on its own. Overlaying
 * every series into a single grid would be cheaper and would make the lines
 * indistinguishable exactly where they cross, which is the part worth reading.
 */
function plot(series: Series, width: number, height: number, low: number, high: number) {
  const cells = new Uint8Array(width * height)
  const span = high - low || 1

  const columns = width * SUBPIXELS.x
  const rows = height * SUBPIXELS.y

  const at = (index: number) => {
    const value = series.points[index]
    if (value === null || value === undefined || !Number.isFinite(value)) return null

    const scaled = ((value - low) / span) * (rows - 1)

    return rows - 1 - Math.max(0, Math.min(rows - 1, Math.round(scaled)))
  }

  const set = (column: number, row: number) => {
    if (column < 0 || column >= columns || row < 0 || row >= rows) return

    const cell = Math.floor(row / SUBPIXELS.y) * width + Math.floor(column / SUBPIXELS.x)
    const bit = DOT[row % SUBPIXELS.y]?.[column % SUBPIXELS.x] ?? 0

    cells[cell] = (cells[cell] ?? 0) | bit
  }

  // Right-aligned: a run that has not filled the window yet grows in from the
  // left rather than stretching, and one that has overflowed drops its oldest
  // samples off the left edge instead of resampling.
  const shift = columns - series.points.length
  let previous: { column: number; row: number } | null = null

  for (let index = 0; index < series.points.length; index++) {
    const column = index + shift
    const row = at(index)

    if (row === null) {
      previous = null
      continue
    }

    if (previous) {
      // Vertical fill between consecutive samples: without it a fast-moving
      // series is a scatter of dots rather than a line.
      const step = previous.row < row ? 1 : -1
      for (let y: number = previous.row; y !== row; y += step) set(column, y)
    }

    set(column, row)
    previous = { column, row }
  }

  return cells
}

function niceStep(span: number) {
  const rough = span / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1))
  const normalized = rough / magnitude

  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10

  return step * magnitude
}

function bounds(series: readonly Series[]) {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY

  for (const line of series) {
    for (const value of line.points) {
      if (value === null || !Number.isFinite(value)) continue
      if (value < low) low = value
      if (value > high) high = value
    }
  }

  if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: 0, high: 1 }
  if (low === high) return { low: Math.min(0, low), high: high + 1 }

  // A chart that does not include zero exaggerates every wobble into a cliff.
  const padded = { low: Math.min(low, 0), high }
  const step = niceStep(padded.high - padded.low)

  return { low: Math.floor(padded.low / step) * step, high: Math.ceil(padded.high / step) * step }
}

function paint(color: string, text: string, colors: boolean) {
  return colors ? `\u001b[${color}m${text}\u001b[0m` : text
}

/**
 * The chart, as lines ready to print. Returned rather than written, so the
 * dashboard can compose one frame and emit it in a single write — drawing
 * piecemeal is what makes a redrawing terminal UI flicker.
 */
export function renderChart(series: readonly Series[], options: ChartOptions): string[] {
  const { width, height, colors } = options
  const { low, high } = bounds(series)

  const labels = axisLabels(low, high, height)
  const labelWidth = Math.max(1, ...labels.map(label => label.length))
  const grids = series.map(line => ({
    line,
    cells: plot(line, width, height, low, high),
  }))

  const lines: string[] = []

  for (let row = 0; row < height; row++) {
    let painted = ''

    for (let column = 0; column < width; column++) {
      let glyph = ' '

      // Later series win a shared cell; the legend order is the priority order.
      for (const { line, cells } of grids) {
        const bits = cells[row * width + column] ?? 0
        if (bits === 0) continue

        glyph = paint(line.color, String.fromCharCode(BRAILLE_BASE + bits), colors)
      }

      painted += glyph
    }

    lines.push(`${(labels[row] ?? '').padStart(labelWidth)} │${painted}`)
  }

  const legend = series.map(line => paint(line.color, `── ${line.label}`, colors)).join('   ')

  lines.push(`${' '.repeat(labelWidth)} └${'─'.repeat(width)}`)
  lines.push(`${' '.repeat(labelWidth + 2)}${legend}`)

  return lines
}

/**
 * Ticks on round values, on the rows nearest to where they fall — rather than
 * one label per row, which spreads the range evenly and lands on numbers like
 * 8.2 and 5.5 that nobody can read a chart against.
 */
function axisLabels(low: number, high: number, height: number) {
  const labels = new Array<string>(height).fill('')
  const span = high - low || 1
  const step = niceStep(span)

  for (let value = Math.ceil(low / step) * step; value <= high + step / 1_000; value += step) {
    const row = Math.round(((high - value) / span) * (height - 1))
    if (row >= 0 && row < height) labels[row] = formatAxis(value)
  }

  return labels
}

function formatAxis(value: number) {
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  if (Number.isInteger(value)) return String(value)
  if (Math.abs(value) >= 10) return value.toFixed(0)

  return value.toFixed(1)
}
