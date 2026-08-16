import type { Vector3 } from '@pollo/contracts'

/** Which cell a device is in, kept so a reading can be recognised as staying put. */
interface Cell {
  column: number
  row: number
}

/**
 * A uniform grid over the event's local metres: who is standing near this point,
 * without looking at everybody.
 *
 * Cells are square in the horizontal plane only. Keying on altitude would split
 * a balcony from the floor below it and hide the measurement that ties the two
 * levels together.
 */
export class FieldGrid {
  private readonly cellSize: number
  private readonly occupants = new Map<string, Set<string>>()
  private readonly cellOf = new Map<string, Cell>()

  /**
   * `cellSize` only decides how much of the field gets scanned, never whether
   * the answer is complete. Around half the search radius is a fair start.
   */
  constructor(cellSize: number) {
    this.cellSize = cellSize
  }

  get size() {
    return this.cellOf.size
  }

  /**
   * Puts a device at a point, and reports whether that moved it to another cell.
   * A cell boundary is not a useful stand-in for "this device moved" — a point
   * reported from GPS crosses lines while its owner stands still — so treat the
   * answer as a fact about the index, not as a signal.
   */
  place(deviceId: string, point: Vector3): boolean {
    const column = Math.floor(point.x / this.cellSize)
    const row = Math.floor(point.y / this.cellSize)
    const previous = this.cellOf.get(deviceId)

    if (previous && previous.column === column && previous.row === row) return false

    if (previous) this.evict(deviceId, previous)

    const key = cellKey(column, row)
    let occupants = this.occupants.get(key)

    if (!occupants) {
      occupants = new Set()
      this.occupants.set(key, occupants)
    }

    occupants.add(deviceId)
    this.cellOf.set(deviceId, { column, row })

    return true
  }

  remove(deviceId: string) {
    const cell = this.cellOf.get(deviceId)
    if (!cell) return

    this.evict(deviceId, cell)
    this.cellOf.delete(deviceId)
  }

  /**
   * Every device within `radius` metres of the point, plus the corners of the
   * square that covers it — a candidate list, which the caller filters.
   *
   * The window is derived from the radius, so no relationship between cell size
   * and radius has to hold. Getting that wrong crashes nothing; the grid just
   * stops mentioning peers who are standing right there.
   *
   * `into` is reused: the list is walked once and this runs often.
   */
  around(point: Vector3, radius: number, into: string[] = []): string[] {
    into.length = 0

    const firstColumn = Math.floor((point.x - radius) / this.cellSize)
    const lastColumn = Math.floor((point.x + radius) / this.cellSize)
    const firstRow = Math.floor((point.y - radius) / this.cellSize)
    const lastRow = Math.floor((point.y + radius) / this.cellSize)

    for (let column = firstColumn; column <= lastColumn; column++) {
      for (let row = firstRow; row <= lastRow; row++) {
        const occupants = this.occupants.get(cellKey(column, row))
        if (!occupants) continue

        for (const deviceId of occupants) into.push(deviceId)
      }
    }

    return into
  }

  /** Empty cells go rather than linger: a crowd that moves leaves a trail of them. */
  private evict(deviceId: string, cell: Cell) {
    const key = cellKey(cell.column, cell.row)
    const occupants = this.occupants.get(key)

    if (!occupants) return

    occupants.delete(deviceId)

    if (occupants.size === 0) this.occupants.delete(key)
  }
}

function cellKey(column: number, row: number) {
  return `${column}:${row}`
}
