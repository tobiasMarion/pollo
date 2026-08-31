import { describe, expect, it } from 'vitest'
import { cloud, type Edge, edgeSource } from '../fixtures/index.js'
import { Csr } from './index.js'

/** What the layout means, written the slow and obvious way. */
function reference(capacity: number, edges: readonly Edge[]) {
  const rows: Array<Array<[number, number]>> = Array.from({ length: capacity }, () => [])

  for (const [from, to, distance] of edges) {
    rows[from]?.push([to, distance])
    rows[to]?.push([from, distance])
  }

  return rows.map(row => row.sort((a, b) => a[0] - b[0] || a[1] - b[1]))
}

function rowsOf(csr: Csr, capacity: number) {
  const rows: Array<Array<[number, number]>> = []

  for (let slot = 0; slot < capacity; slot++) {
    const row: Array<[number, number]> = []

    for (let edge = csr.offsets[slot] ?? 0; edge < (csr.offsets[slot + 1] ?? 0); edge++) {
      row.push([csr.neighbour[edge] ?? 0, csr.distance[edge] ?? 0])
    }

    rows.push(row.sort((a, b) => a[0] - b[0] || a[1] - b[1]))
  }

  return rows
}

describe('Csr', () => {
  it('lays out a real graph exactly as the naive reference does', () => {
    const built = cloud({ seed: 5, count: 40 })
    const csr = new Csr()

    csr.rebuildIfStale(edgeSource(built.count, built.edges), 1)

    expect(rowsOf(csr, built.count)).toEqual(reference(built.count, built.edges))
  })

  /**
   * A→B and B→A are two devices that each ranged the other: two measurements of
   * one distance, and two residuals in the fit. Both have to reach both ends, or
   * a pair that only one side managed to measure would pull just as hard as one
   * both sides confirmed.
   */
  it('files each measurement under both of its endpoints', () => {
    const csr = new Csr()

    csr.rebuildIfStale(edgeSource(3, [[0, 1, 4]]), 1)

    expect(csr.degreeOf(0)).toBe(1)
    expect(csr.degreeOf(1)).toBe(1)
    expect(csr.degreeOf(2)).toBe(0)

    csr.rebuildIfStale(
      edgeSource(3, [
        [0, 1, 4],
        [1, 0, 4.2],
      ]),
      2,
    )

    expect(csr.degreeOf(0)).toBe(2)
    expect(csr.degreeOf(1)).toBe(2)
  })

  it('rebuilds only when the version moves', () => {
    const csr = new Csr()
    const first = edgeSource(3, [[0, 1, 4] as Edge])

    expect(csr.rebuildIfStale(first, 7)).toBe(true)
    expect(csr.rebuildIfStale(first, 7)).toBe(false)
    expect(csr.rebuildIfStale(edgeSource(3, []), 8)).toBe(true)
    expect(csr.degreeOf(0)).toBe(0)
  })

  it('holds a graph with no edges at all', () => {
    const csr = new Csr()

    csr.rebuildIfStale(edgeSource(4, []), 1)

    expect(rowsOf(csr, 4)).toEqual([[], [], [], []])
  })

  /**
   * Capacity grows as devices arrive, and the buffers are reused when they are
   * already big enough — which means the counting pass has to start from zero
   * rather than from the last window's counts.
   */
  it('reuses its buffers across a shrinking graph without carrying counts over', () => {
    const csr = new Csr()

    csr.rebuildIfStale(
      edgeSource(6, [
        [0, 1, 2],
        [2, 3, 3],
        [4, 5, 4],
      ]),
      1,
    )

    csr.rebuildIfStale(edgeSource(6, [[0, 1, 2] as Edge]), 2)

    expect(rowsOf(csr, 6)).toEqual([[[1, 2]], [[0, 2]], [], [], [], []])
  })
})
