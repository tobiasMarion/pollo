import type { Effect } from '@pollo/contracts'
import { describe, expect, it } from 'vitest'
import type { FieldSource } from '../run/pool.js'
import { attach, createSharedBuffers, DEVICE, writeVector } from '../run/shared.js'
import { createFieldView } from './field.js'

const FIRED_AT = 10_000

const PLAIN = { width: 41, height: 11, colors: false } as const

interface Person {
  truth: [number, number]
  /** Where the worker put them. Absent means the worker has not placed them. */
  estimate?: [number, number]
}

function fieldOf(crowd: Person[], cue: { effect: Effect; firedAt: number } | null = null) {
  const shared = attach(createSharedBuffers(crowd.length), crowd.length)

  crowd.forEach((person, index) => {
    writeVector(shared.truth, index, { x: person.truth[0], y: person.truth[1], z: 0 })
    shared.flags[index] = DEVICE.CONNECTED

    if (!person.estimate) return

    writeVector(shared.estimate, index, { x: person.estimate[0], y: person.estimate[1], z: 0 })
    shared.flags[index] = DEVICE.CONNECTED | DEVICE.PLACED
  })

  return { shared, cue } satisfies FieldSource
}

interface Mark {
  row: number
  column: number
  glyph: string
}

/** Where the ink landed. Without colour the field is one glyph per cell. */
function marks(lines: string[]): Mark[] {
  const found: Mark[] = []

  lines.forEach((line, row) => {
    ;[...line].forEach((glyph, column) => {
      if (glyph !== ' ') found.push({ row, column, glyph })
    })
  })

  return found
}

/** Lit means high on the ramp; occupied but dark sits at the bottom of it. */
function litColumns(lines: string[]) {
  return marks(lines)
    .filter(({ glyph }) => glyph === '@' || glyph === '%')
    .map(({ column }) => column)
}

function quadrant(lines: string[], mark: Mark) {
  return {
    vertical: mark.row < lines.length / 2 ? 'top' : 'bottom',
    horizontal: mark.column < (lines[mark.row] as string).length / 2 ? 'left' : 'right',
  }
}

/** A front whose delay is purely the geometry it is handed. */
function waveAlongX(spreadDelayPerUnit: number): Effect {
  return { name: 'WAVE', direction: 'X', activeTime: 0.2, spreadDelayPerUnit }
}

describe('field view', () => {
  it('says so rather than drawing an empty venue', () => {
    const lines = createFieldView().render(fieldOf([]), { ...PLAIN, now: FIRED_AT })

    expect(lines).toHaveLength(PLAIN.height)
    expect(lines.join(' ')).toContain('waiting')
  })

  it('keeps the crowd where it is standing, with north up', () => {
    // North-west and south-east, and nobody in the other two corners.
    const lines = createFieldView().render(fieldOf([{ truth: [-10, 10] }, { truth: [10, -10] }]), {
      ...PLAIN,
      now: FIRED_AT,
    })

    const corners = marks(lines).map(mark => quadrant(lines, mark))

    expect(corners).toHaveLength(2)
    expect(corners).toContainEqual({ vertical: 'top', horizontal: 'left' })
    expect(corners).toContainEqual({ vertical: 'bottom', horizontal: 'right' })
  })

  it('leaves the devices the worker has not placed dark', () => {
    const cue: Effect = {
      name: 'PULSE',
      coordinateType: 'RELATIVE',
      activeTime: 1,
      spreadDelayPerUnit: 0,
    }

    const at = { ...PLAIN, now: FIRED_AT + 500 }

    const lit = createFieldView().render(
      fieldOf([{ truth: [0, 0], estimate: [0, 0] }], { effect: cue, firedAt: FIRED_AT }),
      at,
    )

    const dark = createFieldView().render(
      fieldOf([{ truth: [0, 0] }], { effect: cue, firedAt: FIRED_AT }),
      at,
    )

    // Occupied either way — the difference is only whether it carries light.
    expect(lit.join('')).toContain('@')
    expect(dark.join('')).not.toContain('@')
    expect(dark.join('')).toContain('·')
  })

  /**
   * The whole reason this screen exists.
   *
   * Three people in a row, and a front that starts in the middle of the crowd. A
   * worker that has them right lights the one in the middle first. A worker that
   * has swapped two of them lights the one on the *end* first — and draws it on
   * the end, because where a dot sits never came from the worker. Exactly one
   * pixel is lit either way, so no number taken over the crowd can tell the two
   * runs apart. The only difference is which person it is, and that is the
   * difference between a wave and a mess.
   *
   * The panel cannot show this. It draws the estimate, so the same broken worker
   * gives it a clean front over a crowd of the wrong shape, and it looks perfect.
   */
  it('lights a pixel from where the worker put it, not from where it is', () => {
    const crowd: Person[] = [{ truth: [-10, 0] }, { truth: [0, 0] }, { truth: [10, 0] }]
    const cue = { effect: waveAlongX(0.1), firedAt: FIRED_AT }

    // Halfway through the 200 ms a pixel stays lit, so whoever is due is at full
    // brightness and the ten-metre neighbours are a whole second from their turn.
    const options = { ...PLAIN, now: FIRED_AT + 100 }

    // Where the three of them are drawn, which no estimate can move.
    const layout = marks(
      createFieldView().render(fieldOf(crowd), { ...PLAIN, now: FIRED_AT }),
    ).sort((left, right) => left.column - right.column)

    const honest = createFieldView().render(
      fieldOf(
        crowd.map(person => ({ ...person, estimate: person.truth })),
        cue,
      ),
      options,
    )

    // The worker swapped the west end with the middle. The centroid, and so the
    // cue itself, is unmoved — only who is standing where.
    const swapped = createFieldView().render(
      fieldOf(
        [
          { truth: [-10, 0], estimate: [0, 0] },
          { truth: [0, 0], estimate: [-10, 0] },
          { truth: [10, 0], estimate: [10, 0] },
        ],
        cue,
      ),
      options,
    )

    expect(litColumns(honest)).toEqual([(layout[1] as Mark).column])
    expect(litColumns(swapped)).toEqual([(layout[0] as Mark).column])
  })

  it('paints half-blocks when the terminal takes colour, and glyphs when it does not', () => {
    const crowd = fieldOf([{ truth: [0, 0] }, { truth: [1, 1] }])

    const painted = createFieldView().render(crowd, { ...PLAIN, colors: true, now: FIRED_AT })
    const plain = createFieldView().render(crowd, { ...PLAIN, now: FIRED_AT })

    expect(painted.join('')).toContain('▀')
    expect(painted.join('')).toContain('[38;2;')
    expect(plain.join('')).not.toContain('[')
  })
})
