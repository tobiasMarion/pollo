import { effectBrightness, type Vector3 } from '@pollo/contracts'
import type { FieldSource } from '../run/pool.js'
import { DEVICE } from '../run/shared.js'

/**
 * The crowd from above, lit by the cue.
 *
 * The two coordinates on this screen come from different places on purpose, and
 * that is the entire instrument. **Where a dot sits is the truth** — the seat the
 * simulator put that person in. **How bright it is comes from the estimate** —
 * the position the worker published back, which is the only position the phone
 * itself would know. Draw both from the same numbers, as the admin panel does,
 * and a cue is always a clean ring, because the geometry that decides the
 * brightness is the geometry being drawn. Cross them and the error stops being a
 * number: a worker that has people in the wrong place lights the wrong people,
 * and the ring arrives as confetti over a crowd standing exactly where it is.
 *
 * RMSE cannot say that. Half a metre of error spread evenly is a slightly soft
 * ring; half a metre concentrated in one clique is a hole in the wave. Same
 * number, and only one of them ruins the show.
 */

/** Half-block: the top subpixel is the foreground, the bottom one the background. */
const HALF_BLOCK = '▀'

const RESET = '\u001b[0m'

/** Back to whatever the terminal draws with — an empty half of a busy cell. */
const DEFAULT_FOREGROUND = '\u001b[39m'
const DEFAULT_BACKGROUND = '\u001b[49m'

/** The colour of a lit pixel — the same light the panel's halo is made of. */
const LIT = { r: 245, g: 242, b: 252 } as const

/**
 * A phone that is switched off, at its dimmest and at crowd density.
 *
 * Cold, and never on the same axis as the light. Grey would be the obvious
 * choice and it is the one that ruins the screen: grey and white differ only in
 * how much of the same thing there is, so a packed cell of dark phones and a
 * sparse cell of lit ones land on the same value and the eye reads both as on.
 * A blue that never appears in the light means "off" is a different kind of
 * thing rather than less of the same one, and the density can then use the whole
 * range it has without ever pretending to be a cue.
 */
const REST = { r: 62, g: 72, b: 104 } as const

/** How much of the resting colour a lone phone gets, against a packed cell's full. */
const LONE_DIM = 0.5

/** How many people in one subpixel read as full density. */
const DENSITY_FULL = 8

/** How fast the frame chases the crowd. Whole numbers of frames, not seconds. */
const REFRAME_EASE = 0.12

/** Metres of padding around the crowd, so nobody is drawn on the border. */
const MARGIN_M = 1.5

/** Without colour, brightness has to become shape. Darkest first. */
const RAMP = [' ', '·', ':', '-', '=', '+', '*', '#', '%', '@'] as const

export interface FieldOptions {
  /** Plot area in terminal cells. Each cell is two subpixels tall. */
  width: number
  height: number
  colors: boolean
  now: number
}

interface Bounds {
  centerX: number
  centerY: number
  /** Half-width and half-height of the framed area, in metres. */
  reachX: number
  reachY: number
}

export interface FieldView {
  render(source: FieldSource, options: FieldOptions): string[]
}

export function createFieldView(): FieldView {
  let frame: Bounds | null = null

  return {
    render(source, options) {
      const { shared } = source
      const { width, height, colors, now } = options
      const rows = height * 2

      const box = boundsOf(shared.truth, shared.flags, shared.count)

      if (!box) return centered('waiting for somebody to connect', width, height)

      frame = frame ? ease(frame, box) : box

      // Square subpixels, so the crowd keeps its shape: one scale for both axes,
      // and it is the axis that runs out first that decides it.
      const scale = Math.min(width / (frame.reachX * 2), rows / (frame.reachY * 2))

      const count = new Uint16Array(width * rows)
      const light = new Float32Array(width * rows)

      const cue = source.cue
      const center = cue ? centroidOfPlaced(shared) : null
      const elapsed = cue ? (now - cue.firedAt) / 1_000 : 0

      const point: Vector3 = { x: 0, y: 0, z: 0 }

      for (let index = 0; index < shared.count; index++) {
        const flag = shared.flags[index] ?? 0
        if ((flag & DEVICE.CONNECTED) === 0) continue

        const column = Math.round(
          width / 2 + ((shared.truth[index * 3] ?? 0) - frame.centerX) * scale,
        )
        const row = Math.round(
          rows / 2 - ((shared.truth[index * 3 + 1] ?? 0) - frame.centerY) * scale,
        )

        if (column < 0 || column >= width || row < 0 || row >= rows) continue

        const cell = row * width + column
        count[cell] = (count[cell] ?? 0) + 1

        // Unplaced stays dark. This screen is a reading of the worker, and a
        // device the worker has not placed has nothing to say about it.
        if (!cue || !center || (flag & DEVICE.PLACED) === 0) continue

        point.x = shared.estimate[index * 3] ?? 0
        point.y = shared.estimate[index * 3 + 1] ?? 0
        point.z = shared.estimate[index * 3 + 2] ?? 0

        const glow = effectBrightness(cue.effect, point, center, elapsed)

        // The brightest of whoever is standing in this subpixel, not the sum: at
        // crowd density a sum saturates on the first frame and the screen goes
        // white, which reports the density rather than the cue.
        if (glow > (light[cell] ?? 0)) light[cell] = glow
      }

      return colors ? paintRows(count, light, width, height) : rampRows(count, light, width, height)
    },
  }
}

/** The box the crowd occupies, or `null` while nobody is connected. */
function boundsOf(truth: Float32Array, flags: Uint8Array, total: number): Bounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let present = 0

  for (let index = 0; index < total; index++) {
    if (((flags[index] ?? 0) & DEVICE.CONNECTED) === 0) continue

    const x = truth[index * 3] ?? 0
    const y = truth[index * 3 + 1] ?? 0

    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    present++
  }

  if (present === 0) return null

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    reachX: Math.max((maxX - minX) / 2 + MARGIN_M, 1),
    reachY: Math.max((maxY - minY) / 2 + MARGIN_M, 1),
  }
}

/**
 * Eased rather than applied, because the box is measured from a crowd that sways.
 * Snapping to it every frame makes the whole venue breathe a subpixel at a time,
 * which reads as the drawing being broken rather than as people standing still.
 */
function ease(from: Bounds, to: Bounds): Bounds {
  const step = (a: number, b: number) => a + (b - a) * REFRAME_EASE

  return {
    centerX: step(from.centerX, to.centerX),
    centerY: step(from.centerY, to.centerY),
    reachX: step(from.reachX, to.reachX),
    reachY: step(from.reachY, to.reachY),
  }
}

/**
 * The middle of the cue, in the frame the brightness is computed in.
 *
 * Estimates rather than truth, and the placed ones only, because that is exactly
 * what the panel uses. Anything else and a skewed ring could be blamed on the two
 * screens having disagreed about where the centre was, which is the one
 * explanation this view exists to rule out.
 */
function centroidOfPlaced(shared: FieldSource['shared']): Vector3 | null {
  let x = 0
  let y = 0
  let z = 0
  let placed = 0

  for (let index = 0; index < shared.count; index++) {
    if (((shared.flags[index] ?? 0) & DEVICE.PLACED) === 0) continue

    x += shared.estimate[index * 3] ?? 0
    y += shared.estimate[index * 3 + 1] ?? 0
    z += shared.estimate[index * 3 + 2] ?? 0
    placed++
  }

  if (placed === 0) return null

  return { x: x / placed, y: y / placed, z: z / placed }
}

/** How full a subpixel is, 0 to 1. Logarithmic: the first few people say the most. */
function densityOf(count: number) {
  return Math.min(1, Math.log2(1 + count) / Math.log2(1 + DENSITY_FULL))
}

/**
 * A subpixel's colour: the resting blue, deepened by how many people share it,
 * crossed towards the light by how bright they are.
 *
 * The two ends of that crossing are chosen so that no amount of density can
 * reach any amount of light — a packed cell of dark phones is the strongest
 * blue there is, and still nothing like the weakest lit one.
 */
function colorOf(count: number, light: number) {
  if (count === 0) return null

  const dim = LONE_DIM + (1 - LONE_DIM) * densityOf(count)
  const mix = (rest: number, lit: number) => Math.round(rest * dim + (lit - rest * dim) * light)

  return { r: mix(REST.r, LIT.r), g: mix(REST.g, LIT.g), b: mix(REST.b, LIT.b) }
}

/**
 * The field as half-blocks: the upper subpixel is the foreground colour, the
 * lower one the background.
 *
 * Colour is emitted only where it changes. Spelling out both channels on every
 * cell is thirty-odd bytes each, which over a wide terminal redrawn twenty times
 * a second is megabytes a second of escape codes for a picture whose neighbouring
 * cells are usually the same shade — and a terminal made to parse all of that
 * lags behind the run it is supposed to be showing.
 */
function paintRows(count: Uint16Array, light: Float32Array, width: number, height: number) {
  const lines: string[] = []

  for (let row = 0; row < height; row++) {
    let painted = ''
    let foreground = ''
    let background = ''

    for (let column = 0; column < width; column++) {
      const top = row * 2 * width + column
      const bottom = (row * 2 + 1) * width + column

      const above = colorOf(count[top] ?? 0, light[top] ?? 0)
      const below = colorOf(count[bottom] ?? 0, light[bottom] ?? 0)

      if (!above && !below) {
        // Reset before the gap, not after every cell: a background left open
        // smears the last colour across the empty half of the venue.
        if (background !== '') {
          painted += RESET
          foreground = ''
          background = ''
        }

        painted += ' '
        continue
      }

      const wanted = above ? `\u001b[38;2;${above.r};${above.g};${above.b}m` : DEFAULT_FOREGROUND
      const under = below ? `\u001b[48;2;${below.r};${below.g};${below.b}m` : DEFAULT_BACKGROUND

      if (wanted !== foreground) {
        painted += wanted
        foreground = wanted
      }

      if (under !== background) {
        painted += under
        background = under
      }

      painted += HALF_BLOCK
    }

    lines.push(background === '' ? painted : painted + RESET)
  }

  return lines
}

/**
 * The same field where colour is not an option — piped, redirected, `NO_COLOR`.
 *
 * One glyph per cell instead of two subpixels, because a character can carry
 * either a shape or an intensity and here the intensity is the message. Vertical
 * resolution halves; what is being read off the screen does not.
 */
function rampRows(count: Uint16Array, light: Float32Array, width: number, height: number) {
  const lines: string[] = []

  for (let row = 0; row < height; row++) {
    let painted = ''

    for (let column = 0; column < width; column++) {
      const top = row * 2 * width + column
      const bottom = (row * 2 + 1) * width + column

      const people = (count[top] ?? 0) + (count[bottom] ?? 0)
      const glow = Math.max(light[top] ?? 0, light[bottom] ?? 0)

      if (people === 0) {
        painted += ' '
        continue
      }

      // Occupied but dark still has to be visible, so the ramp starts at its
      // second glyph and the first one means nobody at all.
      const step = 1 + Math.round(glow * (RAMP.length - 2))

      painted += RAMP[Math.min(RAMP.length - 1, step)]
    }

    lines.push(painted)
  }

  return lines
}

function centered(text: string, width: number, height: number) {
  const lines = new Array<string>(height).fill('')
  const middle = Math.floor(height / 2)

  lines[middle] = text.padStart(Math.floor((width + text.length) / 2)).slice(0, width)

  return lines
}
