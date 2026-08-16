import type { IngestMessage, Location } from '@pollo/contracts'

/** How often the accumulated changes are handed to the store. */
export const WRITE_INTERVAL_MS = 250

export interface EdgeChange {
  from: string
  to: string
  /** Meters, or null to drop the edge. */
  distance: number | null
}

/**
 * One flush, in the order it has to be applied. Removals come first so a device
 * that left and came back inside the window is cleaned up and then re-added,
 * rather than re-added and then deleted.
 */
export interface GraphBatch {
  removed: string[]
  added: string[]
  locations: [string, Location][]
  edges: EdgeChange[]
}

/**
 * What the graph store is owed, accumulated between flushes.
 *
 * The store used to be written once per message, and each write was several
 * round trips awaited one after another — so the cost tracked the crowd's
 * message rate while the throughput did not, and the difference piled up in a
 * queue nothing bounded. Keeping the changes by key instead makes a flush cost
 * what actually changed: two readings from one device in the same window have
 * one useful outcome between them, and a map with an entry per device cannot
 * grow past the number of devices.
 */
export class GraphWriter {
  private readonly added = new Set<string>()
  private readonly locations = new Map<string, Location>()
  private readonly edges = new Map<string, EdgeChange>()
  private readonly removed = new Set<string>()

  joined(deviceId: string, location: Location) {
    this.added.add(deviceId)
    this.locations.set(deviceId, location)
  }

  locationChanged(deviceId: string, location: Location) {
    this.locations.set(deviceId, location)
  }

  edgeChanged(from: string, to: string, distance: number | null) {
    this.edges.set(`${from}>${to}`, { from, to, distance })
  }

  /**
   * A device that arrived and left inside one window was never written, so there
   * is nothing to delete — and deleting it would be the only trace it ever left.
   * Its queued edges go with it, in both directions.
   */
  departed(deviceId: string) {
    this.locations.delete(deviceId)

    if (!this.added.delete(deviceId)) this.removed.add(deviceId)

    for (const [key, edge] of this.edges) {
      if (edge.from === deviceId || edge.to === deviceId) this.edges.delete(key)
    }
  }

  /** How much is waiting. The one number that says whether the store is keeping up. */
  get pending() {
    return this.added.size + this.locations.size + this.edges.size + this.removed.size
  }

  get empty() {
    return this.pending === 0
  }

  take(): GraphBatch {
    const batch: GraphBatch = {
      removed: [...this.removed],
      added: [...this.added],
      locations: [...this.locations],
      edges: [...this.edges.values()],
    }

    this.discard()

    return batch
  }

  /** Throws away what was queued, for a graph that is about to be deleted. */
  discard() {
    this.added.clear()
    this.locations.clear()
    this.edges.clear()
    this.removed.clear()
  }
}

/**
 * The same window, as the worker's stream sees it. Deriving it from the batch
 * rather than recording it separately is what keeps the snapshot in Redis and
 * the deltas on the stream from ever disagreeing.
 */
export function ingestOpsOf(batch: GraphBatch): IngestMessage[] {
  const ops: IngestMessage[] = []
  const arrived = new Set(batch.added)
  const locations = new Map(batch.locations)

  for (const deviceId of batch.removed) ops.push({ op: 'LEAVE', deviceId })

  for (const deviceId of batch.added) {
    const location = locations.get(deviceId)

    if (location) ops.push({ op: 'JOIN', deviceId, location })
  }

  for (const [deviceId, location] of batch.locations) {
    if (!arrived.has(deviceId)) ops.push({ op: 'LOCATION_UPDATE', deviceId, location })
  }

  for (const { from, to, distance } of batch.edges) {
    ops.push({ op: 'DISTANCE', from, to, distance })
  }

  return ops
}
