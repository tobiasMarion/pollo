import { describe, expect, it } from 'vitest'
import { FieldGrid } from './field-grid.js'

const at = (x: number, y: number, z = 0) => ({ x, y, z })

describe('FieldGrid', () => {
  it('reports a first placement as a change of cell', () => {
    const grid = new FieldGrid(5)

    expect(grid.place('a', at(0, 0))).toBe(true)
    expect(grid.size).toBe(1)
  })

  it('says nothing changed while a device jitters inside its cell', () => {
    const grid = new FieldGrid(5)
    grid.place('a', at(0, 0))

    expect(grid.place('a', at(1, 1))).toBe(false)
    expect(grid.place('a', at(4.9, 4.9))).toBe(false)
  })

  it('says a device moved once it crosses into another cell', () => {
    const grid = new FieldGrid(5)
    grid.place('a', at(0, 0))

    expect(grid.place('a', at(5.1, 0))).toBe(true)
    expect(grid.around(at(5.1, 0), 1)).toEqual(['a'])
    expect(grid.around(at(0, 0), 1)).toEqual([])
  })

  it('finds everyone within the radius whatever the cell size', () => {
    // The relationship between cell size and radius is the one thing that could
    // silently hide a peer, so both sides of it are pinned here.
    for (const cellSize of [0.5, 1, 5, 40]) {
      const grid = new FieldGrid(cellSize)

      grid.place('north', at(0, 9.5))
      grid.place('south', at(0, -9.5))
      grid.place('east', at(9.5, 0))
      grid.place('west', at(-9.5, 0))

      expect(grid.around(at(0, 0), 10).sort()).toEqual(['east', 'north', 'south', 'west'])
    }
  })

  it('answers with candidates rather than a filtered list', () => {
    const grid = new FieldGrid(10)
    grid.place('corner', at(9, 9))

    // Fourteen metres away, and still returned: it shares a cell with points
    // that are within range, and rejecting it is the caller's job.
    expect(grid.around(at(0, 0), 5)).toEqual(['corner'])
  })

  it('forgets a removed device, and the cell it emptied', () => {
    const grid = new FieldGrid(5)

    grid.place('a', at(0, 0))
    grid.remove('a')

    expect(grid.size).toBe(0)
    expect(grid.around(at(0, 0), 10)).toEqual([])
  })

  it('ignores a device it never held', () => {
    const grid = new FieldGrid(5)

    expect(() => grid.remove('ghost')).not.toThrow()
  })

  it('reuses the array it is handed', () => {
    const grid = new FieldGrid(5)
    const into: string[] = []

    grid.place('a', at(0, 0))

    expect(grid.around(at(0, 0), 1, into)).toBe(into)
    expect(into).toEqual(['a'])

    grid.remove('a')
    grid.around(at(0, 0), 1, into)

    expect(into).toEqual([])
  })
})
