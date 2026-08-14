import { type CreateEvent, type ExactLocation, exactLocationSchema } from '@pollo/contracts'
import type { FastifyBaseLogger } from 'fastify'
import type { Redis } from 'ioredis'
import type { Metrics } from '../metrics.js'
import type { Bus, PositionsSubscription } from './bus.js'
import type { EventRepository } from './event-repository.js'
import { EventService } from './event-service.js'
import { GraphStore } from './graph-store.js'

export interface EventRegistryOptions {
  repository: EventRepository
  redis: Redis
  bus: Bus
  logger: FastifyBaseLogger
  metrics?: Metrics
}

interface CreateEventData extends CreateEvent {
  adminId: string
}

/**
 * Owns the runtime state of live events. Nothing here runs at import time:
 * `boot()` is called explicitly at startup to rehydrate OPEN events, and
 * `shutdown()` tears every subscription down (without closing the events —
 * an API restart is not an event ending).
 */
export class EventRegistry {
  private readonly repository: EventRepository
  private readonly redis: Redis
  private readonly bus: Bus
  private readonly logger: FastifyBaseLogger
  private readonly metrics: Metrics | undefined

  private readonly services = new Map<string, EventService>()
  private readonly subscriptions = new Map<string, PositionsSubscription>()

  constructor({ repository, redis, bus, logger, metrics }: EventRegistryOptions) {
    this.repository = repository
    this.redis = redis
    this.bus = bus
    this.logger = logger
    this.metrics = metrics
  }

  get(id: string) {
    return this.services.get(id)
  }

  get liveEvents() {
    return this.services.size
  }

  /** Devices connected across every live event. */
  get subscriberCount() {
    return this.sum(service => service.subscriberCount)
  }

  /** Store writes dispatched and not yet applied, across every live event. */
  get pendingWrites() {
    return this.sum(service => service.pendingWrites)
  }

  private sum(of: (service: EventService) => number) {
    let total = 0

    for (const service of this.services.values()) total += of(service)

    return total
  }

  async boot() {
    const openEvents = await this.repository.listOpen()

    for (const { id, latitude, longitude, userId } of openEvents) {
      const service = this.register(id, userId, exactLocationSchema.parse({ latitude, longitude }))

      // Whatever is in the store belongs to sockets this process never had.
      //
      // A device is in the graph because it is connected, and every connection
      // died with the process that held it — so a runtime that has just been
      // built, with no subscribers at all, cannot have a single live node. Left
      // alone they are permanent: nothing ever disconnects them, because there
      // is nothing to disconnect, and the panel goes on drawing a crowd that
      // went home. In development, where the API reloads on every save, that is
      // a fresh layer of ghosts per edit.
      //
      // This assumes one API against one Redis, which is the deployment Pollo
      // has. A second instance booting would wipe the first one's live graph,
      // so scaling out means expiring nodes instead of clearing them.
      await service.clearStaleGraph()
    }

    this.logger.info({ count: openEvents.length }, 'event registry booted')
  }

  async create({ adminId, ...event }: CreateEventData) {
    const { id } = await this.repository.create(event, adminId)

    this.register(id, adminId, { latitude: event.latitude, longitude: event.longitude })

    return id
  }

  /** Ends an event for good: the worker drops its task and the graph is gone. */
  async close(id: string) {
    const service = this.services.get(id)
    if (!service) return

    this.bus.publishControl({ op: 'EVENT_CLOSED', eventId: id })

    this.subscriptions.get(id)?.stop()
    this.subscriptions.delete(id)
    this.services.delete(id)

    // The comment above has always said this; now it is true. A FINISHED event
    // never reopens, so its graph is unreachable the moment it closes — and
    // unguarded, because closing an event with a crowd still in it is the
    // normal way an event ends.
    await service.discardGraph()
    await this.repository.finish(id)
  }

  /** Stops subscriptions without closing events (used on API shutdown). */
  shutdown() {
    for (const subscription of this.subscriptions.values()) {
      subscription.stop()
    }

    this.subscriptions.clear()
    this.services.clear()
  }

  private register(id: string, adminId: string, location: ExactLocation): EventService {
    const service = new EventService({
      id,
      location,
      adminId,
      graphStore: new GraphStore(this.redis, id),
      bus: this.bus,
      logger: this.logger,
      metrics: this.metrics,
    })

    this.services.set(id, service)
    this.subscriptions.set(
      id,
      this.bus.subscribePositions(id, message => service.broadcastPositions(message)),
    )

    this.bus.publishControl({
      op: 'EVENT_OPENED',
      eventId: id,
      latitude: location.latitude,
      longitude: location.longitude,
    })

    return service
  }
}
