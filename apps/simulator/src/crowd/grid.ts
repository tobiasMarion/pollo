/**
 * Who is within radio range of whom, without comparing everyone to everyone.
 * See ./README.md#who-can-hear-whom.
 */
export class SpatialGrid {
  private readonly cellSize: number
  private originX = 0
  private originY = 0
  private columns = 1
  private rows = 1

  private starts = new Int32Array(1)
  private entries = new Int32Array(0)

  /**
   * `presentMask` is passed rather than imported so this module stays ignorant
   * of how the run stores its device flags.
   */
  constructor(
    private readonly truth: Float32Array,
    private readonly flags: Uint8Array,
    private readonly count: number,
    range: number,
    private readonly presentMask: number,
  ) {
    this.cellSize = Math.max(range, 1)
  }

  private present(index: number) {
    return ((this.flags[index] ?? 0) & this.presentMask) !== 0
  }

  rebuild() {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let present = 0

    for (let i = 0; i < this.count; i++) {
      if (!this.present(i)) continue

      const x = this.truth[i * 3] ?? 0
      const y = this.truth[i * 3 + 1] ?? 0

      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      present++
    }

    if (present === 0) {
      this.starts = new Int32Array(2)
      this.entries = new Int32Array(0)
      this.columns = 1
      this.rows = 1
      return
    }

    this.originX = minX
    this.originY = minY
    this.columns = Math.max(1, Math.ceil((maxX - minX) / this.cellSize) + 1)
    this.rows = Math.max(1, Math.ceil((maxY - minY) / this.cellSize) + 1)

    const cells = this.columns * this.rows
    const counts = new Int32Array(cells + 1)

    for (let i = 0; i < this.count; i++) {
      if (!this.present(i)) continue
      counts[this.cellOf(i) + 1] = (counts[this.cellOf(i) + 1] ?? 0) + 1
    }

    for (let cell = 1; cell <= cells; cell++) {
      counts[cell] = (counts[cell] ?? 0) + (counts[cell - 1] ?? 0)
    }

    const cursor = Int32Array.from(counts)
    const entries = new Int32Array(present)

    for (let i = 0; i < this.count; i++) {
      if (!this.present(i)) continue

      const cell = this.cellOf(i)
      entries[cursor[cell] ?? 0] = i
      cursor[cell] = (cursor[cell] ?? 0) + 1
    }

    this.starts = counts
    this.entries = entries
  }

  private cellOf(index: number) {
    const column = this.clamp(
      Math.floor(((this.truth[index * 3] ?? 0) - this.originX) / this.cellSize),
      this.columns,
    )
    const row = this.clamp(
      Math.floor(((this.truth[index * 3 + 1] ?? 0) - this.originY) / this.cellSize),
      this.rows,
    )

    return row * this.columns + column
  }

  private clamp(value: number, bound: number) {
    return Math.min(bound - 1, Math.max(0, value))
  }

  /**
   * Every present device within `range` of `index`, itself excluded. `into` is
   * reused: allocating per device per sweep is twenty thousand arrays a second.
   */
  within(index: number, range: number, into: number[]): number[] {
    into.length = 0

    if (this.entries.length === 0) return into

    const x = this.truth[index * 3] ?? 0
    const y = this.truth[index * 3 + 1] ?? 0
    const z = this.truth[index * 3 + 2] ?? 0

    const column = this.clamp(Math.floor((x - this.originX) / this.cellSize), this.columns)
    const row = this.clamp(Math.floor((y - this.originY) / this.cellSize), this.rows)
    const rangeSquared = range * range

    for (let dRow = -1; dRow <= 1; dRow++) {
      const currentRow = row + dRow
      if (currentRow < 0 || currentRow >= this.rows) continue

      for (let dColumn = -1; dColumn <= 1; dColumn++) {
        const currentColumn = column + dColumn
        if (currentColumn < 0 || currentColumn >= this.columns) continue

        const cell = currentRow * this.columns + currentColumn
        const from = this.starts[cell] ?? 0
        const to = this.starts[cell + 1] ?? from

        for (let slot = from; slot < to; slot++) {
          const other = this.entries[slot] ?? -1
          if (other === index || other < 0) continue

          const dx = (this.truth[other * 3] ?? 0) - x
          const dy = (this.truth[other * 3 + 1] ?? 0) - y
          const dz = (this.truth[other * 3 + 2] ?? 0) - z

          if (dx * dx + dy * dy + dz * dz <= rangeSquared) into.push(other)
        }
      }
    }

    return into
  }
}
