/**
 * Whatever holds the measured distances, seen from the solver's side.
 *
 * Structural on purpose: the worker's graph is a map of maps that has to be
 * cheap to *update*, and this package has no business knowing that. Three
 * members is the entire contract, and anything that can enumerate its pairs
 * satisfies it.
 */
export interface EdgeSource {
  /** Slot count, live and free alike — the length every flat array is indexed by. */
  readonly capacity: number
  /** Directed edges held. Both directions of a pair count separately. */
  readonly edgeCount: number
  forEachEdge(visit: (from: number, to: number, distance: number) => void): void
}

/**
 * The graph, laid out for the sweep instead of for updating.
 *
 * Compressed sparse row: `offsets[i]` to `offsets[i + 1]` is the span of
 * `neighbour` and `distance` belonging to slot `i`. The sweep reads it as three
 * contiguous runs, which is what the hardware is good at — a map of maps is a
 * pointer chase per neighbour, and the sweep visits every neighbour of every
 * device several times a second.
 *
 * Rebuilt when the caller's version moves, which is once per ingest window at
 * most. Never per sweep.
 */
export class Csr {
  offsets = new Int32Array(1)
  neighbour = new Int32Array(0)
  distance = new Float64Array(0)

  private builtFrom = -1

  /**
   * Whether anything was rebuilt.
   *
   * The version is the caller's to define and the caller's to bump; all this
   * asks is that it move whenever the edges do.
   */
  rebuildIfStale(source: EdgeSource, version: number) {
    if (version === this.builtFrom) return false

    this.rebuild(source)
    this.builtFrom = version

    return true
  }

  degreeOf(slot: number) {
    return (this.offsets[slot + 1] ?? 0) - (this.offsets[slot] ?? 0)
  }

  /**
   * Both directions of a pair are kept, and each is attached to **both** of its
   * endpoints.
   *
   * A→B and B→A are two devices that each ranged the other: two independent
   * measurements of one distance, and in a least-squares fit two measurements
   * are two residuals. Averaging them first, or keeping only one, throws away
   * the second observation — the pair should pull twice as hard as a pair only
   * one end managed to measure, because it is twice as well known.
   */
  private rebuild(source: EdgeSource) {
    const capacity = source.capacity
    const entries = source.edgeCount * 2

    if (this.offsets.length < capacity + 1) this.offsets = new Int32Array(capacity + 1)
    else this.offsets.fill(0)

    if (this.neighbour.length < entries) {
      this.neighbour = new Int32Array(entries)
      this.distance = new Float64Array(entries)
    }

    // Counting pass, then a prefix sum, then a filling pass. One allocation of
    // the right size beats an array of arrays that grows.
    const counts = this.offsets

    source.forEachEdge((from, to) => {
      counts[from + 1] = (counts[from + 1] ?? 0) + 1
      counts[to + 1] = (counts[to + 1] ?? 0) + 1
    })

    for (let slot = 0; slot < capacity; slot++) {
      counts[slot + 1] = (counts[slot + 1] ?? 0) + (counts[slot] ?? 0)
    }

    const cursor = new Int32Array(capacity)

    source.forEachEdge((from, to, distance) => {
      const atFrom = (this.offsets[from] ?? 0) + (cursor[from] ?? 0)
      this.neighbour[atFrom] = to
      this.distance[atFrom] = distance
      cursor[from] = (cursor[from] ?? 0) + 1

      const atTo = (this.offsets[to] ?? 0) + (cursor[to] ?? 0)
      this.neighbour[atTo] = from
      this.distance[atTo] = distance
      cursor[to] = (cursor[to] ?? 0) + 1
    })
  }
}
