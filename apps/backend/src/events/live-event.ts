import {
  type ExactLocation,
  type Location,
  type Measurement,
  type Message,
  type Participant,
  type PositionsMessage,
  projectLocation,
} from '@pollo/contracts'
import type { FastifyBaseLogger } from 'fastify'
import type { Metrics } from '../observability/metrics.js'
import { AdminDigest, DIGEST_INTERVAL_MS } from './batching/admin-digest.js'
import { GraphWriter, ingestOpsOf, WRITE_INTERVAL_MS } from './batching/graph-writer.js'
import { ASSIGNMENT_INTERVAL_MS, Neighborhood } from './neighborhood/neighborhood.js'
import type { Bus } from './redis/bus.js'
import type { GraphStore } from './redis/graph-store.js'

/**
 * How the socket handlers hand a frame back to one connection. A fan-out passes
 * the serialised form along so the crowd costs one `JSON.stringify`, not one
 * per recipient.
 */
export type SendMessage = (message: Message, serialised?: string) => void

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

  private readonly neighborhood = new Neighborhood()
  private assignmentTimer: ReturnType<typeof setInterval> | null = null

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

    // The stream carries the same window the store gets, one entry instead of
    // one per mutation.
    this.bus.publishIngest(this.id, { at: startedAt, ops: ingestOpsOf(batch) })

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

  /** Only runs while somebody is connected to be given a list. */
  private scheduleAssignments() {
    if (this.assignmentTimer) return

    this.assignmentTimer = setInterval(() => this.flushAssignments(), ASSIGNMENT_INTERVAL_MS)
    this.assignmentTimer.unref?.()
  }

  /**
   * Hands out the lists that changed, and nothing else.
   *
   * This is what replaced announcing arrivals. A device that joins used to cost
   * a frame to every device already here, and one to itself for every device
   * that arrived after — quadratic in the crowd, and measured at 136,000 frames
   * a second on a four-thousand-device ramp. What a device actually did with
   * any of that was decide who to range against, which is the one thing sent
   * now, to the few whose answer changed.
   */
  flushAssignments(now = Date.now()) {
    if (this.subscribers.size === 0) {
      this.stopAssigning()
      return
    }

    const assignments = this.neighborhood.takeAssignments(now)

    for (const { deviceId, peers } of assignments) {
      this.subscribers.get(deviceId)?.sendMessage({ type: 'SET_NEIGHBORS', peers })
    }

    const { computed, scanned } = this.neighborhood.lastFlush

    this.metrics?.count('framesOut', assignments.length)
    this.metrics?.count('assign:computed', computed)
    this.metrics?.count('assign:scanned', scanned)
  }

  private stopAssigning() {
    if (!this.assignmentTimer) return

    clearInterval(this.assignmentTimer)
    this.assignmentTimer = null
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

  /**
   * Whether anybody is watching the field.
   *
   * Nothing is kept for the panel while nobody is: the digest used to be fed on
   * every message regardless, and the only thing that empties it is a flush that
   * gives up when there is no admin — so a run with no panel open accumulated
   * every location and every edge for the life of the event. At ten thousand
   * phones that was 11% of the process and most of a gigabyte, kept for a reader
   * that did not exist.
   */
  private get watched() {
    return this.admin.sendMessage !== undefined
  }

  setAdminConnection(send: SendMessage) {
    // Whatever happened while nobody watched is not this panel's history: it
    // opens from the REST snapshot and follows with batches from here.
    this.digest.discard()
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
   * Who is connected right now, straight from the connection map rather than
   * from the store, whose writes are a flush behind on purpose.
   *
   * This is the panel's opening snapshot. Devices no longer read it — they are
   * told which peers to measure instead of being handed the crowd.
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

    const serialised = JSON.stringify(message)

    for (const { sendMessage } of this.subscribers.values()) {
      sendMessage(message, serialised)
    }
  }

  subscribe({ deviceId, location, sendMessage }: Subscriber) {
    if (this.watched) this.digest.locationChanged(deviceId, location)

    this.subscribers.set(deviceId, { sendMessage, location })

    this.neighborhood.place(deviceId, projectLocation(location, this.location))
    this.scheduleAssignments()

    // The store copy exists for REST reads and worker hydration; the stream
    // publish is what actually drives the simulation.
    this.writer.joined(deviceId, location)
    this.scheduleWrites()
  }

  /**
   * One sweep from one device. Ignores a device that is no longer here: a socket
   * that dies with frames still queued gets them handled after its `close`, and
   * an edge written after the departure is one nothing would ever remove.
   */
  setDistancesFromDevice(from: string, measurements: readonly Measurement[]) {
    if (!this.subscribers.has(from)) return

    for (const { to, distance } of measurements) {
      this.writer.edgeChanged(from, to, distance)

      if (this.watched) this.digest.edgeChanged(from, to, distance)
    }

    this.scheduleWrites()
  }

  updateSubscriberLocation(deviceId: string, location: Location) {
    const connection = this.subscribers.get(deviceId)
    if (!connection) return

    connection.location = location

    if (this.watched) this.digest.locationChanged(deviceId, location)

    this.writer.locationChanged(deviceId, location)
    this.scheduleWrites()

    this.neighborhood.place(deviceId, projectLocation(location, this.location))
  }

  unsubscribe(deviceId: string) {
    if (!this.subscribers.has(deviceId)) return

    this.subscribers.delete(deviceId)

    this.writer.departed(deviceId)
    this.scheduleWrites()

    this.neighborhood.remove(deviceId)

    if (this.watched) this.digest.departed(deviceId)
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

      if (this.watched) this.digest.placedAt(deviceId, position)

      this.metrics?.count('framesOut')
    }
  }
}
