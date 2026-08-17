import type { EventGraph } from '../ingest/graph.js'

/**
 * The graph, laid out for the sweep instead of for updating.
 *
 * Compressed sparse row: `offsets[i]` to `offsets[i + 1]` is the span of
 * `neighbour` and `distance` belonging to slot `i`. The sweep reads it as three
 * contiguous runs, which is what the hardware is good at — the map of maps the
 * ingest side keeps is a pointer chase per neighbour, and the sweep visits every
 * neighbour of every device several times a second.
 *
 * Rebuilt when the graph's version moves, which is once per ingest window at
 * most. Never per sweep.
 */
export class Adjacency {
  offsets = new Int32Array(1)
  neighbour = new Int32Array(0)
  distance = new Float64Array(0)

  private builtFrom = -1

  /** Whether anything was rebuilt. */
  rebuildIfStale(graph: EventGraph) {
    if (graph.version === this.builtFrom) return false

    this.rebuild(graph)
    this.builtFrom = graph.version

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
  private rebuild(graph: EventGraph) {
    const capacity = graph.capacity
    const entries = graph.edgeCount * 2

    if (this.offsets.length < capacity + 1) this.offsets = new Int32Array(capacity + 1)
    else this.offsets.fill(0)

    if (this.neighbour.length < entries) {
      this.neighbour = new Int32Array(entries)
      this.distance = new Float64Array(entries)
    }

    // Counting pass, then a prefix sum, then a filling pass. One allocation of
    // the right size beats an array of arrays that grows.
    const counts = this.offsets

    graph.forEachEdge((from, to) => {
      counts[from + 1] = (counts[from + 1] ?? 0) + 1
      counts[to + 1] = (counts[to + 1] ?? 0) + 1
    })

    for (let slot = 0; slot < capacity; slot++) {
      counts[slot + 1] = (counts[slot + 1] ?? 0) + (counts[slot] ?? 0)
    }

    const cursor = new Int32Array(capacity)

    graph.forEachEdge((from, to, distance) => {
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
