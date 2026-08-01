import type { ExactLocation, Location, Message, PositionsMessage } from '@pollo/contracts'
import type { FastifyBaseLogger } from 'fastify'
import { AdminDigest, DIGEST_INTERVAL_MS } from './admin-digest.js'
import type { Bus } from './bus.js'
import type { GraphStore } from './graph-store.js'

/** How the socket handlers hand a frame back to one connection. */
export type SendMessage = (message: Message) => void

export interface Subscriber {
  deviceId: string
  location: Location
  sendMessage: SendMessage
}

interface Admin {
  userId: string
  sendMessage: SendMessage | undefined
}

export interface EventServiceOptions {
  id: string
  location: ExactLocation
  adminId: string
  graphStore: GraphStore
  bus: Bus
  logger?: FastifyBaseLogger
}

/**
 * Pure IO for a live event: holds the connections (admin + subscribers), fans
 * out messages, persists the graph (REST reads + worker hydration) and
 * publishes mutations to the ingest stream. ALL position math lives in the
 * worker — no simulation ever runs here, never on the event loop.
 */
export class EventService {
  private readonly id: string
  private readonly location: ExactLocation
  private readonly admin: Admin
  private readonly subscribers = new Map<string, SendMessage>()
  private readonly graphStore: GraphStore
  private readonly bus: Bus
  private readonly logger: FastifyBaseLogger | undefined

  private pendingStoreWrites: Promise<unknown> = Promise.resolve()

  private readonly digest = new AdminDigest()
  private digestTimer: ReturnType<typeof setInterval> | null = null

  constructor({ id, location, adminId, graphStore, bus, logger }: EventServiceOptions) {
    this.id = id
    this.location = location
    this.graphStore = graphStore
    this.bus = bus
    this.logger = logger
    this.admin = { userId: adminId, sendMessage: undefined }
  }

  /**
   * Store writes stay off the hot path (never awaited by callers), but they
   * must apply in dispatch order — otherwise a removeEdge can overtake the
   * setEdge that preceded it and resurrect the edge.
   */
  private enqueueStoreWrite(write: () => Promise<unknown>) {
    this.pendingStoreWrites = this.pendingStoreWrites
      .then(write)
      .catch(error => this.logger?.error({ err: error }, 'graph store write failed'))
  }

  /** Resolves once every store write dispatched so far has been applied. */
  async settled() {
    await this.pendingStoreWrites
  }

  getAdminId() {
    return this.admin.userId
  }

  getLocation() {
    return this.location
  }

  setAdminConnection(send: SendMessage) {
    this.admin.sendMessage = send

    if (this.digestTimer) return

    // Only runs while somebody is watching. With no panel connected there is
    // nothing to flush to, and an interval per open event would tick for the
    // life of the process with no reader.
    this.digestTimer = setInterval(() => this.flushDigest(), DIGEST_INTERVAL_MS)
    this.digestTimer.unref?.()
  }

  clearAdminConnection() {
    this.admin.sendMessage = undefined

    if (this.digestTimer) {
      clearInterval(this.digestTimer)
      this.digestTimer = null
    }
  }

  /**
   * Sends the batch, or nothing at all. A quiet second should not wake the
   * browser up to hand it four empty arrays.
   */
  flushDigest() {
    if (!this.admin.sendMessage || this.digest.empty) return

    this.admin.sendMessage(this.digest.take(DIGEST_INTERVAL_MS))
  }

  async getSubscribers() {
    const metadata = await this.graphStore.listNodesMetadata()

    return Object.entries(metadata).map(([deviceId, data]) => ({
      deviceId,
      location: data.location,
    }))
  }

  async getEventGraph() {
    return await this.graphStore.getEventGraph()
  }

  /**
   * Straight to the admin, unbatched. Only for frames the panel acts on the
   * moment they arrive rather than draws — its own cue, coming back.
   */
  notifyAdmin(message: Message) {
    this.admin.sendMessage?.(message)
  }

  publish(message: Message) {
    this.notifyAdmin(message)

    for (const sendMessage of this.subscribers.values()) {
      sendMessage(message)
    }
  }

  /** Fans out to the devices; the admin hears about it in the next batch. */
  private broadcastToDevices(message: Message) {
    for (const sendMessage of this.subscribers.values()) {
      sendMessage(message)
    }
  }

  subscribe({ deviceId, location, sendMessage }: Subscriber) {
    this.broadcastToDevices({ type: 'USER_JOINED', deviceId, location })
    this.digest.locationChanged(deviceId, location)

    this.subscribers.set(deviceId, sendMessage)

    // The store copy exists for REST reads and worker hydration; the stream
    // publish is what actually drives the simulation.
    this.enqueueStoreWrite(() => this.graphStore.addNode(deviceId))
    this.enqueueStoreWrite(() => this.graphStore.setNodeLocation(deviceId, location))
    this.bus.publishIngest(this.id, { op: 'JOIN', deviceId, location })
  }

  /**
   * Ignores a measurement from a device that is no longer here, which
   * `updateSubscriberLocation` has always done and this had not.
   *
   * The gap was not theoretical. A socket that dies with frames still queued
   * gets its `DISTANCE` handled after its `close`, so `setEdge` ran after
   * `removeNode` — and `setEdge` adds both endpoints as nodes, resurrecting the
   * device that had just been cleaned up. Its edge hash came back with it and
   * nothing ever removed it again: the device was gone, so no later departure
   * would sweep it. What that leaves behind is a graph of edges between devices
   * that no longer exist, and a panel loading it reads zero devices and a
   * distance between two of them.
   */
  setDistanceToDevice(from: string, to: string, distance: number | null) {
    if (!this.subscribers.has(from)) return

    if (distance === null) {
      this.enqueueStoreWrite(() => this.graphStore.removeEdge(from, to))
    } else {
      this.enqueueStoreWrite(() => this.graphStore.setEdge({ from, to, value: distance }))
    }

    this.digest.edgeChanged(from, to, distance)

    this.bus.publishIngest(this.id, { op: 'DISTANCE', from, to, distance })
  }

  updateSubscriberLocation(deviceId: string, location: Location) {
    if (!this.subscribers.has(deviceId)) return

    this.digest.locationChanged(deviceId, location)
    this.enqueueStoreWrite(() => this.graphStore.setNodeLocation(deviceId, location))

    this.bus.publishIngest(this.id, { op: 'LOCATION_UPDATE', deviceId, location })
  }

  unsubscribe(deviceId: string) {
    if (!this.subscribers.has(deviceId)) return

    this.subscribers.delete(deviceId)
    this.enqueueStoreWrite(() => this.graphStore.removeNode(deviceId))

    this.broadcastToDevices({ type: 'USER_LEFT', deviceId })
    this.digest.departed(deviceId)

    this.bus.publishIngest(this.id, { op: 'LEAVE', deviceId })
  }

  /**
   * Fans out worker-computed positions (called by the positions subscription).
   * Only position travels — brightness is client-side.
   */
  broadcastPositions(message: PositionsMessage) {
    for (const { deviceId, position } of message.points) {
      this.subscribers.get(deviceId)?.({ type: 'SET_POINT', position })

      this.digest.placedAt(deviceId, position)
    }
  }
}
