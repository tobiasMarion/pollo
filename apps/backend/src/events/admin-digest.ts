import type { Location, MessageOf, NodePosition } from '@pollo/contracts'

/** How often the field is cut into a batch and sent to the admin panel. */
export const DIGEST_INTERVAL_MS = 1_000

type FieldUpdate = MessageOf<'FIELD_UPDATE'>

/**
 * What the admin panel is owed, accumulated between sends.
 *
 * The panel used to be handed a frame per device event. That makes it a
 * subscriber to the crowd's message rate — twenty thousand phones reporting
 * once a second is twenty thousand frames a second, before distances — and no
 * browser parses that, however little work each frame implies.
 *
 * It also does not need to. A panel draws a field; it is not following an event
 * log. Two location updates from one device in the same second have exactly one
 * useful outcome between them, so they are kept by device id and the older one
 * is simply overwritten. The cost of a batch is therefore bounded by how many
 * devices exist rather than by how talkative they were.
 */
export class AdminDigest {
  private readonly locations = new Map<string, Location>()
  private readonly placed = new Map<string, NodePosition>()
  private readonly left = new Set<string>()
  private readonly edges = new Map<string, { from: string; to: string; distance: number | null }>()

  /**
   * A join and a move are the same entry: the panel keys devices by id and
   * creates what it does not know, so telling it which of the two happened
   * would only give it a distinction to ignore.
   */
  locationChanged(deviceId: string, location: Location) {
    // A device that left and came back inside one window is present, not gone.
    this.left.delete(deviceId)
    this.locations.set(deviceId, location)
  }

  placedAt(deviceId: string, position: NodePosition) {
    if (this.left.has(deviceId)) return

    this.placed.set(deviceId, position)
  }

  /**
   * Leaving wins over everything queued about the device, so a join and a
   * departure inside one window collapse to nothing the panel has to undo.
   *
   * Queued edges go with it. A device that measured a peer and then
   * disconnected inside the same window would otherwise put an edge and its own
   * departure in one batch: whoever applies the departure first drops an edge
   * that has not arrived yet, and then adds it. The result is a distance
   * between devices that are gone, which nothing later ever retracts — the
   * server has already said everything it had to say about that pair.
   */
  departed(deviceId: string) {
    this.locations.delete(deviceId)
    this.placed.delete(deviceId)
    this.left.add(deviceId)

    for (const [key, edge] of this.edges) {
      if (edge.from === deviceId || edge.to === deviceId) this.edges.delete(key)
    }
  }

  edgeChanged(from: string, to: string, distance: number | null) {
    // Nothing more to say about a pair that is already leaving; the panel is
    // being told to forget both ends of it.
    if (this.left.has(from) || this.left.has(to)) return

    this.edges.set(`${from}>${to}`, { from, to, distance })
  }

  get empty() {
    return (
      this.locations.size === 0 &&
      this.placed.size === 0 &&
      this.left.size === 0 &&
      this.edges.size === 0
    )
  }

  /** Cuts a batch and starts a new one. */
  take(window = DIGEST_INTERVAL_MS): FieldUpdate {
    const update: FieldUpdate = {
      type: 'FIELD_UPDATE',
      at: Date.now(),
      window,
      locations: [...this.locations].map(([deviceId, location]) => ({ deviceId, location })),
      placed: [...this.placed].map(([deviceId, position]) => ({ deviceId, position })),
      left: [...this.left],
      edges: [...this.edges.values()],
    }

    this.locations.clear()
    this.placed.clear()
    this.left.clear()
    this.edges.clear()

    return update
  }
}
