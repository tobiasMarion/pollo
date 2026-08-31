import { describe, expect, it } from 'vitest'
import { EdgeTable } from './index.js'

function pairs(edges: EdgeTable) {
  const seen: Array<[number, number, number]> = []

  edges.forEachEdge((from, to, distance) => seen.push([from, to, distance]))

  return seen.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

describe('EdgeTable', () => {
  it('counts a direction once however often it is re-measured', () => {
    const edges = new EdgeTable()

    expect(edges.set(0, 1, 4)).toBe(true)
    expect(edges.set(0, 1, 4.3)).toBe(false)
    expect(edges.count).toBe(1)
    expect(pairs(edges)).toEqual([[0, 1, 4.3]])
  })

  /** A→B and B→A are two devices that each ranged the other, and both are kept. */
  it('keeps the two directions of a pair apart', () => {
    const edges = new EdgeTable()

    edges.set(0, 1, 4)
    edges.set(1, 0, 4.2)

    expect(edges.count).toBe(2)
    expect(edges.degreeOf(0)).toBe(1)
    expect(edges.degreeOf(1)).toBe(1)
  })

  it('says whether a drop actually removed anything', () => {
    const edges = new EdgeTable()

    edges.set(0, 1, 4)

    expect(edges.drop(0, 1)).toBe(true)
    expect(edges.drop(0, 1)).toBe(false)
    expect(edges.drop(5, 6)).toBe(false)
    expect(edges.count).toBe(0)
  })

  /**
   * The reverse index exists for exactly this: without it, finding who measured
   * a departing device is a scan of the whole graph.
   */
  it('removes a slot from both directions and names everyone who lost an edge', () => {
    const edges = new EdgeTable()

    edges.set(1, 0, 4)
    edges.set(2, 0, 5)
    edges.set(0, 3, 6)

    expect(edges.removeSlot(0).sort()).toEqual([1, 2, 3])
    expect(edges.count).toBe(0)
    expect(pairs(edges)).toEqual([])
    expect(edges.degreeOf(1)).toBe(0)
  })

  it('leaves the rest of the graph alone when a slot goes', () => {
    const edges = new EdgeTable()

    edges.set(0, 1, 4)
    edges.set(2, 3, 5)
    edges.removeSlot(0)

    expect(edges.count).toBe(1)
    expect(pairs(edges)).toEqual([[2, 3, 5]])
  })

  it('has nothing to remove for a slot that was never in the graph', () => {
    const edges = new EdgeTable()

    edges.set(0, 1, 4)

    expect(edges.removeSlot(9)).toEqual([])
    expect(edges.count).toBe(1)
  })
})
