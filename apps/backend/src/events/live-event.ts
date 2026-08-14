import type {
  ExactLocation,
  Location,
  Message,
  Participant,
  PositionsMessage,
} from '@pollo/contracts'
import type { FastifyBaseLogger } from 'fastify'
import type { Metrics } from '../observability/metrics.js'
import { AdminDigest, DIGEST_INTERVAL_MS } from './batching/admin-digest.js'
import { GraphWriter, WRITE_INTERVAL_MS } from './batching/graph-writer.js'
import type { Bus } from './redis/bus.js'
import type { GraphStore } from './redis/graph-store.js'

/** How the socket handlers hand a frame back to one connection. */
export type SendMessage = (message: Message) => void

export interface Subscriber {
  deviceId: string
  location: Location
  sendMessage: SendMessage
}

/** A live device: how to reach it, and the last thing it said about itself. */
interface Connection {
  sendMessage: SendMessage
  location: Location
}

interface Admin {
  userId: string
  sendMessage: SendMessage | undefined
}

export interface LiveEventOptions {
  id: string
  location: ExactLocation
  adminId: string
  graphStore: GraphStore
  bus: Bus
  logger?: FastifyBaseLogger
  metrics?: Metrics
}

/**
 * Pure IO for a live event: holds the connections (admin + subscribers), fans
 * out messages, persists the graph (REST reads + worker hydration) and
 * publishes mutations to the ingest stream. ALL position math lives in the
 * worker — no simulation ever runs here, never on the event loop.
 */
export class LiveEvent {
  private readonly id: string
  private readonly location: ExactLocation
  private readonly admin: Admin
  private readonly subscribers = new Map<string, Connection>()
  private readonly graphStore: GraphStore
  private readonly bus: Bus
  private readonly logger: FastifyBaseLogger | undefined
  private readonly metrics: Metrics | undefined

  private readonly writer = new GraphWriter()
  private writeTimer: ReturnType<typeof setInterval> | null = null
  private flushing: Promise<void> | null = null

  private readonly digest = new AdminDigest()
  private digestTimer: ReturnType<typeof setInterval> | null = null

  constructor({ id, location, adminId, graphStore, bus, logger, metrics }: LiveEventOptions) {
    this.id = id
    this.location = location
    this.graphStore = graphStore
    this.bus = bus
    this.logger = logger
    this.metrics = metrics
    this.admin = { userId: adminId, sendMessage: undefined }
  }

  get subscriberCount() {
    return this.subscribers.size
  }

  /**
   * Changes waiting for the next flush. Bounded by how many devices there are
   * rather than by how much they said, which is the whole point of batching.
   */
  get pendingWrites() {
    return this.writer.pending
  }

  /** Only runs while there is something to write. */
  private scheduleWrites() {
    if (this.writeTimer) return

    this.writeTimer = setInterval(() => void this.flushWrites(), WRITE_INTERVAL_MS)
    this.writeTimer.unref?.()
  }

  private stopWriting() {
    if (!this.writeTimer) return

    clearInterval(this.writeTimer)
    this.writeTimer = null
  }

  /**
   * One flush at a time. A batch still in flight while the next tick fires would
   * race it — removals of one batch against the adds of the other — and skipping
   * the tick costs nothing, because what accumulates meanwhile is coalesced into
   * the batch after it.
   */
  private async flushWrites(): Promise<void> {
    if (this.flushing) return await this.flushing

    if (this.writer.empty) {
      this.stopWriting()
      return
    }

    const batch = this.writer.take()
    const startedAt = Date.now()

    this.flushing = this.graphStore
      .applyBatch(batch)
      .then(() => {
        this.metrics?.observe('storeFlushMs', Date.now() - startedAt)
      })
      .catch(error => this.logger?.error({ err: error }, 'graph store write failed'))
      .finally(() => {
        this.flushing = null
      })

    await this.flushing
  }

  /** Resolves once everything written so far has reached the store. */
  async settled() {
    await this.flushing

    if (!this.writer.empty) await this.flushWrites()
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

  /**
   * Who is connected right now, straight from the connection map.
   *
   * Read from the graph store this would lag, because those writes are queued
   * off the hot path — and a device joining reads the roster the moment it
   * connects, so a stale answer is a device that never learns about a peer.
   * Nothing else would tell it: `USER_JOINED` only covers arrivals *after* this
   * point, which is precisely what makes this snapshot the thing they continue
   * from. Missing somebody here means missing them for good.
   */
  getSubscribers(): Participant[] {
    return [...this.subscribers].map(([deviceId, { location }]) => ({ deviceId, location }))
  }

  async getEventGraph() {
    return await this.graphStore.getEventGraph()
  }

  /**
   * Throws the graph away because the event is over. Whoever is still connected
   * is about to be disconnected by the closing itself, so their nodes go too.
   */
  async discardGraph() {
    this.stopWriting()
    this.writer.discard()

    await this.flushing
    await this.graphStore.deleteGraph()
  }

  /**
   * Throws away a graph nobody is connected to any more.
   *
   * A node exists because a device is connected, so with an empty subscriber map
   * every node in the store is a leftover from a process that is gone. The guard
   * is the whole argument: this is only sound before the first socket is
   * accepted, and calling it anywhere else is a mistake worth a stack trace
   * rather than a silently emptied field.
   */
  async clearStaleGraph() {
    if (this.subscribers.size > 0) {
      throw new Error(`Refusing to clear the graph of ${this.id}: it has live subscribers.`)
    }

    await this.discardGraph()
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
    this.broadcastToDevices(message)
  }

  /** Fans out to the devices; the admin hears about it in the next batch. */
  private broadcastToDevices(message: Message) {
    // Once for the whole fan-out; the size is known before the loop starts.
    this.metrics?.count('framesOut', this.subscribers.size)

    for (const { sendMessage } of this.subscribers.values()) {
      sendMessage(message)
    }
  }

  subscribe({ deviceId, location, sendMessage }: Subscriber) {
    this.broadcastToDevices({ type: 'USER_JOINED', deviceId, location })
    this.digest.locationChanged(deviceId, location)

    this.subscribers.set(deviceId, { sendMessage, location })

    // The store copy exists for REST reads and worker hydration; the stream
    // publish is what actually drives the simulation.
    this.writer.joined(deviceId, location)
    this.scheduleWrites()
    this.bus.publishIngest(this.id, { op: 'JOIN', deviceId, location })
  }

  /**
   * Ignores a measurement from a device that is no longer here. A socket that
   * dies with frames still queued gets them handled after its `close`, and an
   * edge written after the departure is one nothing would ever remove.
   */
  setDistanceToDevice(from: string, to: string, distance: number | null) {
    if (!this.subscribers.has(from)) return

    this.writer.edgeChanged(from, to, distance)
    this.scheduleWrites()

    this.digest.edgeChanged(from, to, distance)

    this.bus.publishIngest(this.id, { op: 'DISTANCE', from, to, distance })
  }

  updateSubscriberLocation(deviceId: string, location: Location) {
    const connection = this.subscribers.get(deviceId)
    if (!connection) return

    connection.location = location

    this.digest.locationChanged(deviceId, location)
    this.writer.locationChanged(deviceId, location)
    this.scheduleWrites()

    this.bus.publishIngest(this.id, { op: 'LOCATION_UPDATE', deviceId, location })
  }

  unsubscribe(deviceId: string) {
    if (!this.subscribers.has(deviceId)) return

    this.subscribers.delete(deviceId)

    this.writer.departed(deviceId)
    this.scheduleWrites()

    this.broadcastToDevices({ type: 'USER_LEFT', deviceId })
    this.digest.departed(deviceId)

    this.bus.publishIngest(this.id, { op: 'LEAVE', deviceId })
  }

  /**
   * Fans out worker-computed positions (called by the positions subscription).
   * Only position travels — brightness is client-side.
   *
   * Positions for devices that are gone are dropped, the same guard the other
   * three mutators carry. The worker is a separate process working from a
   * snapshot, so it is *always* a little behind the connection map: it will
   * publish a position for somebody who disconnected a moment ago, and it is
   * right to. What that must not do is reach the panel. `placedAt` is an upsert
   * at the far end, so a stale point recreates the device the panel was just
   * told to forget — and the next one recreates it again. Kill a simulation of
   * a thousand phones and the field never empties.
   */
  broadcastPositions(message: PositionsMessage) {
    for (const { deviceId, position } of message.points) {
      const connection = this.subscribers.get(deviceId)
      if (!connection) continue

      connection.sendMessage({ type: 'SET_POINT', position })
      this.digest.placedAt(deviceId, position)

      this.metrics?.count('framesOut')
    }
  }
}
