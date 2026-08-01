import {
  type AdminOutboundMessage,
  adminInbound,
  type Effect,
  type EventGraph,
  type Location,
  type MessageOf,
  type NodePosition,
  safeParseJsonMessage,
  socketPaths,
  WS_CLOSE,
} from '@pollo/contracts'
import { SvelteMap } from 'svelte/reactivity'
import { apiSocketUrl } from '$lib/api/client'

export interface DeviceState {
  deviceId: string
  /** Null while the only thing seen about a device is a position. */
  location: Location | null
  /** Absent until the worker has published a position for this device. */
  position: NodePosition | null
  /**
   * What the two above were before the last batch. Updates arrive once a
   * second; without somewhere to move *from*, the field would tick rather than
   * move, so the canvas glides between the two across `window`.
   */
  previousLocation: Location | null
  previousPosition: NodePosition | null
  /** When the current values landed, and how long the glide has to cover. */
  changedAt: number
  window: number
}

export type ConnectionStatus =
  | 'connecting'
  | 'authenticating'
  | 'live'
  | 'reconnecting'
  | 'rejected'
  | 'closed'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15_000

export function edgeKey(from: string, to: string): string {
  return `${from}>${to}`
}

/**
 * Live state of one event, fed by the admin socket.
 *
 * Devices and edges are reactive maps: the panel watches an event, not the
 * whole swarm, so hundreds of entries stay well inside what fine-grained
 * reactivity handles. The canvas reads the same maps every frame.
 */
export class EventConsole {
  readonly devices = new SvelteMap<string, DeviceState>()
  readonly edges = new SvelteMap<string, { from: string; to: string; value: number }>()

  status = $state<ConnectionStatus>('connecting')
  /** Set when the socket is closed for good — a reconnect would not help. */
  error = $state<string | null>(null)
  /** The last effect fired, and when, so views can echo the wavefront. */
  lastEffect = $state<{ effect: Effect; firedAt: number } | null>(null)

  #eventId: string
  #token: string
  #socket: WebSocket | null = null
  #retries = 0
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #closedByUs = false

  constructor(eventId: string, token: string) {
    this.#eventId = eventId
    this.#token = token
  }

  /** Seeds the maps from `GET /events/:id/graph` so the view starts populated. */
  hydrate(graph: EventGraph) {
    const now = Date.now()

    for (const [deviceId, metadata] of Object.entries(graph.nodes)) {
      this.devices.set(deviceId, {
        deviceId,
        location: metadata.location,
        position: metadata.position ?? null,
        previousLocation: null,
        previousPosition: null,
        changedAt: now,
        window: 0,
      })
    }

    for (const edge of graph.edges) {
      this.edges.set(edgeKey(edge.from, edge.to), edge)
    }
  }

  connect() {
    this.#closedByUs = false

    const socket = new WebSocket(apiSocketUrl(socketPaths.admin(this.#eventId)))
    this.#socket = socket
    this.status = this.#retries === 0 ? 'connecting' : 'reconnecting'

    socket.addEventListener('open', () => {
      this.status = 'authenticating'
      this.#send({ type: 'AUTHENTICATION', token: this.#token })
    })

    socket.addEventListener('message', message => {
      this.#receive(message.data)
    })

    socket.addEventListener('close', event => {
      this.#socket = null

      if (this.#closedByUs) {
        this.status = 'closed'
        return
      }

      // 4401 is the admin check failing and 4404 an event the runtime does not
      // hold: both are verdicts, not hiccups, so retrying only spins.
      if (event.code === WS_CLOSE.UNAUTHORIZED || event.code === WS_CLOSE.NOT_FOUND) {
        this.status = 'rejected'
        this.error = event.reason || 'The API refused this event.'
        return
      }

      this.#scheduleReconnect()
    })
  }

  fireEffect(effect: Effect) {
    if (this.status !== 'live') return

    this.#send({ type: 'EFFECT', effect })
  }

  destroy() {
    this.#closedByUs = true

    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)

    this.#socket?.close()
    this.#socket = null
    this.status = 'closed'
  }

  #send(message: AdminOutboundMessage) {
    this.#socket?.send(JSON.stringify(message))
  }

  #scheduleReconnect() {
    this.status = 'reconnecting'

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.#retries, RECONNECT_MAX_MS)
    this.#retries += 1

    this.#reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  #receive(raw: unknown) {
    if (typeof raw !== 'string') return

    // Validated rather than cast: the panel is a client of a contract it does
    // not control, and a frame it cannot read is one to drop, not to render.
    const { success, data: message } = safeParseJsonMessage(raw, adminInbound.schema)

    if (!success) return

    const now = Date.now()

    switch (message.type) {
      case 'AUTHENTICATION_ACK':
        // Only now are reports guaranteed to flow.
        this.status = 'live'
        this.error = null
        this.#retries = 0
        break

      case 'FIELD_UPDATE':
        this.#applyBatch(message, now)
        break

      case 'EFFECT':
        this.lastEffect = { effect: message.effect, firedAt: now }
        break
    }
  }

  /**
   * The whole batch, applied in one pass.
   *
   * Departures go last on purpose. The server already keeps a batch consistent
   * — nothing it sends references a device it is also reporting gone — but
   * arrivals before departures is the only order that stays right if that ever
   * slips, because a stale edge added after the sweep is one nothing later
   * retracts: the server has said all it has to say about that pair.
   */
  #applyBatch(update: MessageOf<'FIELD_UPDATE'>, now: number) {
    for (const { deviceId, location } of update.locations) {
      this.#upsertDevice(deviceId, now, update.window, { location })
    }

    for (const { deviceId, position } of update.placed) {
      this.#upsertDevice(deviceId, now, update.window, { position })
    }

    for (const edge of update.edges) {
      const key = edgeKey(edge.from, edge.to)

      // A null distance means the devices went out of range: the edge is
      // dropped, not zeroed.
      if (edge.distance === null) {
        this.edges.delete(key)
      } else {
        this.edges.set(key, { from: edge.from, to: edge.to, value: edge.distance })
      }
    }

    if (update.left.length === 0) return

    for (const deviceId of update.left) {
      this.devices.delete(deviceId)
    }

    // One sweep for the whole batch rather than one per departure: the map
    // holds an edge per pair, and walking it for each of a thousand leavers is
    // the shape of stall this batching exists to avoid.
    const gone = new Set(update.left)

    for (const [key, edge] of this.edges) {
      if (gone.has(edge.from) || gone.has(edge.to)) this.edges.delete(key)
    }
  }

  /**
   * A batch can name a device the panel never saw arrive — it joined while the
   * socket was down, and batches carry changes rather than replaying history.
   * Whatever the entry carries is enough to start tracking it.
   */
  #upsertDevice(
    deviceId: string,
    now: number,
    window: number,
    patch: { location?: Location; position?: NodePosition },
  ) {
    const existing = this.devices.get(deviceId)

    this.devices.set(deviceId, {
      deviceId,
      location: patch.location ?? existing?.location ?? null,
      position: patch.position ?? existing?.position ?? null,
      // A device seen for the first time has nowhere to glide from and should
      // simply appear where it is.
      previousLocation: existing?.location ?? null,
      previousPosition: existing?.position ?? null,
      changedAt: now,
      window,
    })
  }
}

/** Positions the worker has published — the only devices worth drawing. */
export function positionedDevices(devices: Iterable<DeviceState>): DeviceState[] {
  return [...devices].filter((device): device is DeviceState & { position: NodePosition } =>
    Boolean(device.position),
  )
}
