import { describe, expect, it } from 'vitest'
import { renderChart, type Series, SUBPIXELS } from './chart.js'

const plain = { width: 20, height: 4, colors: false }

function body(lines: string[]) {
  // The last two lines are the axis rule and the legend.
  return lines.slice(0, -2).map(line => line.split('│')[1] ?? '')
}

function ramp(from: number, to: number, count: number) {
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1))
}

describe('renderChart', () => {
  it('draws only braille and spaces in the plot area', () => {
    const series: Series[] = [{ label: 'a', color: '36', points: ramp(0, 10, 40) }]

    for (const line of body(renderChart(series, plain))) {
      for (const glyph of line) {
        const code = glyph.charCodeAt(0)
        expect(glyph === ' ' || (code >= 0x2800 && code <= 0x28ff)).toBe(true)
      }
    }
  })

  it('gives every row the axis, the rule and the legend', () => {
    const lines = renderChart([{ label: 'a', color: '36', points: [1, 2, 3] }], plain)

    expect(lines).toHaveLength(plain.height + 2)
    expect(lines[plain.height]).toContain('└')
    expect(lines[plain.height + 1]).toContain('a')
  })

  it('puts a rising series at the bottom on the left and the top on the right', () => {
    const lines = body(renderChart([{ label: 'a', color: '36', points: ramp(0, 100, 40) }], plain))

    const firstRow = lines[0] ?? ''
    const lastRow = lines[lines.length - 1] ?? ''

    expect(firstRow.trimEnd().length).toBeGreaterThan(firstRow.trimStart().length - 1)
    expect(lastRow.indexOf(lastRow.trim()[0] ?? ' ')).toBeLessThan(5)
    expect(firstRow.lastIndexOf(firstRow.trim().slice(-1))).toBeGreaterThan(plain.width - 5)
  })

  it('right-aligns a series shorter than the window', () => {
    const lines = body(renderChart([{ label: 'a', color: '36', points: [5, 5, 5] }], plain))
    const drawn = lines.find(line => line.trim().length > 0) ?? ''

    expect(drawn.trimEnd().length).toBe(plain.width)
    expect(drawn.startsWith(' ')).toBe(true)
  })

  it('drops the oldest samples when the series overflows the window', () => {
    const capacity = plain.width * SUBPIXELS.x
    const points = [...new Array(capacity).fill(0), ...new Array(capacity).fill(50)]

    const lines = body(renderChart([{ label: 'a', color: '36', points }], plain))

    // Only the newer half survives, so the plot runs along the top. The bottom
    // row keeps at most the single column where the line climbs in from the
    // sample that fell off the left edge.
    expect((lines[0] ?? '').trim().length).toBeGreaterThan(plain.width / 2)
    expect((lines[lines.length - 1] ?? '').trim().length).toBeLessThanOrEqual(1)
  })

  it('leaves gaps where a series has no value', () => {
    const points = [...new Array(20).fill(null), ...new Array(20).fill(30)]
    const lines = body(renderChart([{ label: 'a', color: '36', points }], plain))

    const filled = lines.map(line => line.trimEnd().length)

    expect(Math.max(...filled)).toBe(plain.width)
    for (const line of lines) expect(line.slice(0, 4).trim()).toBe('')
  })

  it('says nothing at all when every series is empty', () => {
    const lines = body(renderChart([{ label: 'a', color: '36', points: [] }], plain))

    for (const line of lines) expect(line.trim()).toBe('')
  })

  it('survives a series that never changes', () => {
    const lines = renderChart([{ label: 'a', color: '36', points: ramp(7, 7, 30) }], plain)

    expect(lines).toHaveLength(plain.height + 2)
    expect(body(lines).some(line => line.trim().length > 0)).toBe(true)
  })

  it('anchors the axis at zero so a wobble does not read as a cliff', () => {
    const lines = renderChart([{ label: 'a', color: '36', points: ramp(100, 101, 30) }], plain)
    const labels = lines.slice(0, plain.height).map(line => (line.split('│')[0] ?? '').trim())

    expect(labels[labels.length - 1]).toBe('0')
  })

  it('emits colour only when asked', () => {
    const series: Series[] = [{ label: 'a', color: '36', points: ramp(0, 10, 20) }]

    const colored = renderChart(series, { ...plain, colors: true }).join('')
    const bare = renderChart(series, plain).join('')

    expect(colored).toContain('\u001b[36m')
    expect(bare).not.toContain('\u001b')
  })

  it('keeps two series apart rather than merging them', () => {
    const series: Series[] = [
      { label: 'low', color: '33', points: ramp(0, 0, 30) },
      { label: 'high', color: '36', points: ramp(90, 90, 30) },
    ]

    const colored = renderChart(series, { ...plain, colors: true }).join('\n')

    expect(colored).toContain('\u001b[33m')
    expect(colored).toContain('\u001b[36m')
  })
})
