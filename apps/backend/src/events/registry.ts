import { type CreateEvent, type ExactLocation, exactLocationSchema } from '@pollo/contracts';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Bus, PositionsSubscription } from './bus.js';
import { EventService } from './event-service.js';
import { GraphStore } from './graph-store.js';

export interface EventRegistryOptions {
  prisma: PrismaClient;
  redis: Redis;
  bus: Bus;
  logger: FastifyBaseLogger;
}

interface CreateEventData extends CreateEvent {
  adminId: string;
}

/**
 * Owns the runtime state of live events. Nothing here runs at import time:
 * `boot()` is called explicitly at startup to rehydrate OPEN events, and
 * `shutdown()` tears every subscription down (without closing the events —
 * an API restart is not an event ending).
 */
export class EventRegistry {
  private readonly prisma: PrismaClient;
  private readonly redis: Redis;
  private readonly bus: Bus;
  private readonly logger: FastifyBaseLogger;

  private readonly services = new Map<string, EventService>();
  private readonly subscriptions = new Map<string, PositionsSubscription>();

  constructor({ prisma, redis, bus, logger }: EventRegistryOptions) {
    this.prisma = prisma;
    this.redis = redis;
    this.bus = bus;
    this.logger = logger;
  }

  get(id: string) {
    return this.services.get(id);
  }

  async boot() {
    const openEvents = await this.prisma.event.findMany({ where: { status: 'OPEN' } });

    for (const { id, latitude, longitude, userId } of openEvents) {
      this.register(id, userId, exactLocationSchema.parse({ latitude, longitude }));
    }

    this.logger.info({ count: openEvents.length }, 'event registry booted');
  }

  async create({ name, latitude, longitude, type, adminId }: CreateEventData) {
    const { id } = await this.prisma.event.create({
      data: { name, latitude, longitude, type, userId: adminId },
    });

    this.register(id, adminId, { latitude, longitude });

    return id;
  }

  /** Ends an event for good: the worker drops its task and the graph is gone. */
  async close(id: string) {
    const service = this.services.get(id);
    if (!service) return;

    this.bus.publishControl({ op: 'EVENT_CLOSED', eventId: id });

    this.subscriptions.get(id)?.stop();
    this.subscriptions.delete(id);
    this.services.delete(id);

    await this.prisma.event.update({
      where: { id },
      data: { status: 'FINISHED' },
    });
  }

  /** Stops subscriptions without closing events (used on API shutdown). */
  shutdown() {
    for (const subscription of this.subscriptions.values()) {
      subscription.stop();
    }

    this.subscriptions.clear();
    this.services.clear();
  }

  private register(id: string, adminId: string, location: ExactLocation) {
    const service = new EventService({
      id,
      location,
      adminId,
      graphStore: new GraphStore(this.redis, id),
      bus: this.bus,
      logger: this.logger,
    });

    this.services.set(id, service);
    this.subscriptions.set(
      id,
      this.bus.subscribePositions(id, (message) => service.broadcastPositions(message)),
    );

    this.bus.publishControl({
      op: 'EVENT_OPENED',
      eventId: id,
      latitude: location.latitude,
      longitude: location.longitude,
    });
  }
}
