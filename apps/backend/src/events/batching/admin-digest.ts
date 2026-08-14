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

  /**
   * Distances by origin, `from` to `to` to metres.
   *
   * A flat map keyed `"from>to"` reads better and costs a string and an object
   * on every measurement the crowd reports — forty thousand a second at ten
   * thousand phones, all of it garbage within the second. Nested, the entry is
   * two map writes and the wire objects are built once, in `take`.
   */
  private readonly edges = new Map<string, Map<string, number | null>>()

  /** Who measured each device, so a departure does not scan every edge. */
  private readonly measuredBy = new Map<string, Set<string>>()

  private edgeCount = 0

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

    this.dropOutgoing(deviceId)
    this.dropIncoming(deviceId)
  }

  edgeChanged(from: string, to: string, distance: number | null) {
    // Nothing more to say about a pair that is already leaving; the panel is
    // being told to forget both ends of it.
    if (this.left.has(from) || this.left.has(to)) return

    let outgoing = this.edges.get(from)

    if (!outgoing) {
      outgoing = new Map()
      this.edges.set(from, outgoing)
    }

    if (!outgoing.has(to)) this.edgeCount++

    outgoing.set(to, distance)

    let measurers = this.measuredBy.get(to)

    if (!measurers) {
      measurers = new Set()
      this.measuredBy.set(to, measurers)
    }

    measurers.add(from)
  }

  /** Everything this device measured. */
  private dropOutgoing(deviceId: string) {
    const outgoing = this.edges.get(deviceId)
    if (!outgoing) return

    for (const to of outgoing.keys()) {
      const measurers = this.measuredBy.get(to)

      measurers?.delete(deviceId)

      if (measurers?.size === 0) this.measuredBy.delete(to)
    }

    this.edgeCount -= outgoing.size
    this.edges.delete(deviceId)
  }

  /** Everything that measured this device. */
  private dropIncoming(deviceId: string) {
    for (const from of this.measuredBy.get(deviceId) ?? []) {
      const outgoing = this.edges.get(from)

      if (outgoing?.delete(deviceId)) this.edgeCount--
      if (outgoing?.size === 0) this.edges.delete(from)
    }

    this.measuredBy.delete(deviceId)
  }

  get empty() {
    return (
      this.locations.size === 0 &&
      this.placed.size === 0 &&
      this.left.size === 0 &&
      this.edgeCount === 0
    )
  }

  /** Cuts a batch and starts a new one. */
  take(window = DIGEST_INTERVAL_MS): FieldUpdate {
    const edges: FieldUpdate['edges'] = []

    for (const [from, outgoing] of this.edges) {
      for (const [to, distance] of outgoing) edges.push({ from, to, distance })
    }

    const update: FieldUpdate = {
      type: 'FIELD_UPDATE',
      at: Date.now(),
      window,
      locations: [...this.locations].map(([deviceId, location]) => ({ deviceId, location })),
      placed: [...this.placed].map(([deviceId, position]) => ({ deviceId, position })),
      left: [...this.left],
      edges,
    }

    this.discard()

    return update
  }

  /** Throws the window away, for a panel that is about to start from a snapshot. */
  discard() {
    this.locations.clear()
    this.placed.clear()
    this.left.clear()
    this.edges.clear()
    this.measuredBy.clear()
    this.edgeCount = 0
  }
}
