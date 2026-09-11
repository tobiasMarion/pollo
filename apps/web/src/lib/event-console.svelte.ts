import {
  type AdminOutboundMessage,
  adminInbound,
  type Effect,
  type EventGraph,
  type MessageOf,
  safeParseJsonMessage,
  socketPaths,
  type Vector3,
  WS_CLOSE,
} from '@pollo/contracts'
import { apiSocketUrl, createApiClient } from '$lib/api/client'
import { FieldState } from '$lib/field-state.svelte'

export type { DeviceState } from '$lib/field-state.svelte'

export type ConnectionStatus =
  | 'connecting'
  | 'authenticating'
  | 'live'
  | 'reconnecting'
  | 'rejected'
  | 'closed'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15_000

export interface EventConsoleOptions {
  loadGraph?: () => Promise<EventGraph>
  openSocket?: (url: string) => WebSocket
}

/**
 * Live state of one event, fed by the admin socket.
 *
 * Devices and edges are reactive maps: the panel watches an event, not the
 * whole swarm, so hundreds of entries stay well inside what fine-grained
 * reactivity handles. The canvas reads the same maps every frame.
 */
export class EventConsole {
  readonly field = new FieldState()
  readonly devices = this.field.devices
  readonly edges = this.field.edges

  status = $state<ConnectionStatus>('connecting')
  /** Set when the socket is closed for good — a reconnect would not help. */
  error = $state<string | null>(null)
  /** The last effect fired, and when, so views can echo the wavefront. */
  lastEffect = $state<{ effect: Effect; firedAt: number; center: Vector3 } | null>(null)

  #eventId: string
  #token: string
  #socket: WebSocket | null = null
  #retries = 0
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #closedByUs = false
  #loadGraph: () => Promise<EventGraph>
  #openSocket: (url: string) => WebSocket
  #synchronizing = false
  #pendingUpdates: MessageOf<'FIELD_UPDATE'>[] = []

  constructor(eventId: string, token: string, options: EventConsoleOptions = {}) {
    this.#eventId = eventId
    this.#token = token
    this.#loadGraph =
      options.loadGraph ??
      (() => createApiClient({ token: this.#token }).getEventGraph(this.#eventId))
    this.#openSocket = options.openSocket ?? (url => new WebSocket(url))
  }

  /** Seeds the maps from `GET /events/:id/graph` so the view starts populated. */
  hydrate(graph: EventGraph) {
    this.field.replace(graph)
  }

  connect() {
    this.#closedByUs = false

    const socket = this.#openSocket(apiSocketUrl(socketPaths.admin(this.#eventId)))
    this.#socket = socket
    this.#pendingUpdates = []
    this.status = this.#retries === 0 ? 'connecting' : 'reconnecting'

    socket.addEventListener('open', () => {
      if (this.#socket !== socket) return
      this.status = 'authenticating'
      this.#send({ type: 'AUTHENTICATION', token: this.#token })
    })

    socket.addEventListener('message', message => {
      if (this.#socket === socket) this.#receive(message.data, socket)
    })

    socket.addEventListener('close', event => {
      if (this.#socket !== socket) return
      this.#socket = null
      this.#synchronizing = false
      this.#pendingUpdates = []

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

    this.#send({ type: 'FIRE_EFFECT', effect })
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

  #receive(raw: unknown, socket: WebSocket) {
    if (typeof raw !== 'string') return

    // Validated rather than cast: the panel is a client of a contract it does
    // not control, and a frame it cannot read is one to drop, not to render.
    const { success, data: message } = safeParseJsonMessage(raw, adminInbound.schema)

    if (!success) return

    const now = Date.now()

    switch (message.type) {
      case 'AUTHENTICATION_ACK':
        void this.#reconcile(socket)
        break

      case 'FIELD_UPDATE':
        if (this.#synchronizing) {
          this.#pendingUpdates.push(message)
        } else {
          this.field.apply(message, now)
        }
        break

      case 'EFFECT':
        this.lastEffect = { effect: message.effect, firedAt: now, center: message.center }
        break
    }
  }

  async #reconcile(socket: WebSocket) {
    if (this.#socket !== socket || this.#synchronizing) return

    this.#synchronizing = true
    let refreshed = false

    try {
      const graph = await this.#loadGraph()
      if (this.#socket !== socket) return

      this.field.replace(graph)
      refreshed = true
    } catch {
      // The socket is already live. Keep the last known field and apply the
      // buffered deltas; the next reconnect gets another chance at a snapshot.
      this.error = 'The live connection resumed, but its snapshot could not be refreshed.'
    } finally {
      if (this.#socket === socket) {
        for (const update of this.#pendingUpdates) this.field.apply(update)

        this.#pendingUpdates = []
        this.#synchronizing = false
        this.status = 'live'
        this.#retries = 0
        if (refreshed) this.error = null
      }
    }
  }
}
