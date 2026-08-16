import fastifyPlugin from 'fastify-plugin'
import { EventRegistry } from '../events/event-registry.js'
import { type Bus, RedisStreamsBus } from '../events/redis/bus.js'

export interface EventsRuntimePluginOptions {
  bus?: Bus
}

export const eventsRuntimePlugin = fastifyPlugin<EventsRuntimePluginOptions>(
  async (app, options) => {
    const bus = options.bus ?? new RedisStreamsBus(app.redis, app.log)

    const events = new EventRegistry({
      repository: app.eventRepository,
      redis: app.redis,
      bus,
      logger: app.log,
      metrics: app.metrics,
    })

    app.decorate('bus', bus)
    app.decorate('events', events)

    app.metrics.gauge('liveEvents', () => events.liveEvents)
    app.metrics.gauge('connections', () => events.subscriberCount)
    app.metrics.gauge('pendingWrites', () => events.pendingWrites)

    // Rehydrate OPEN events once the app is fully wired — no import-time IO.
    app.addHook('onReady', async () => {
      await events.boot()
    })

    app.addHook('onClose', async () => {
      events.shutdown()
    })
  },
  { name: 'events-runtime', dependencies: ['metrics', 'repositories', 'redis'] },
)

declare module 'fastify' {
  interface FastifyInstance {
    bus: Bus
    events: EventRegistry
  }
}
