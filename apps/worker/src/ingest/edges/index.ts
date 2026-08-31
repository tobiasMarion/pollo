/**
 * The measured distances, as they arrive and as they go away.
 *
 * Directed: A→B and B→A are two devices that each ranged the other, and both are
 * kept. The reverse index is what a departure needs — without it, finding who
 * measured a leaving device is a scan of the whole graph.
 *
 * Every method reports what it changed rather than deciding what that means. The
 * graph above decides.
 */
export class EdgeTable {
  private readonly outgoing = new Map<number, Map<number, number>>()
  private readonly incoming = new Map<number, Set<number>>()

  private total = 0

  /** Directed edges held. Both directions of a pair count separately. */
  get count() {
    return this.total
  }

  degreeOf(slot: number) {
    return this.outgoing.get(slot)?.size ?? 0
  }

  /**
   * Every directed edge, handed to a callback rather than yielded.
   *
   * A generator over a hundred and sixty thousand edges allocates a hundred and
   * sixty thousand result objects, several times a second, for a loop that
   * wants three numbers.
   */
  forEachEdge(visit: (from: number, to: number, distance: number) => void) {
    for (const [from, neighbours] of this.outgoing) {
      for (const [to, distance] of neighbours) visit(from, to, distance)
    }
  }

  /** Whether this direction of the pair had never been measured before. */
  set(from: number, to: number, distance: number) {
    let neighbours = this.outgoing.get(from)

    if (!neighbours) {
      neighbours = new Map()
      this.outgoing.set(from, neighbours)
    }

    const fresh = !neighbours.has(to)

    if (fresh) this.total++

    neighbours.set(to, distance)

    let measuredBy = this.incoming.get(to)

    if (!measuredBy) {
      measuredBy = new Set()
      this.incoming.set(to, measuredBy)
    }

    measuredBy.add(from)

    return fresh
  }

  /** Whether an edge actually went away. */
  drop(from: number, to: number) {
    const dropped = this.outgoing.get(from)?.delete(to) ?? false

    if (dropped) this.total--

    this.incoming.get(to)?.delete(from)

    return dropped
  }

  /** Takes a slot out of the graph, and reports every slot that lost an edge by it. */
  removeSlot(slot: number) {
    const affected: number[] = []

    for (const to of this.outgoing.get(slot)?.keys() ?? []) {
      this.incoming.get(to)?.delete(slot)
      affected.push(to)
      this.total--
    }

    for (const from of this.incoming.get(slot) ?? []) {
      if (this.outgoing.get(from)?.delete(slot)) this.total--
      affected.push(from)
    }

    this.outgoing.delete(slot)
    this.incoming.delete(slot)

    return affected
  }
}
