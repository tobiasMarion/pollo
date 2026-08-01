import fastifyPlugin from 'fastify-plugin'
import { type Bus, RedisStreamsBus } from '../events/bus.js'
import { EventRegistry } from '../events/registry.js'

export interface EventsRuntimePluginOptions {
  bus?: Bus
}

export const eventsRuntimePlugin = fastifyPlugin<EventsRuntimePluginOptions>(
  async (app, options) => {
    const bus = options.bus ?? new RedisStreamsBus(app.redis, app.log)

    const events = new EventRegistry({
      prisma: app.prisma,
      redis: app.redis,
      bus,
      logger: app.log,
    })

    app.decorate('bus', bus)
    app.decorate('events', events)

    // Rehydrate OPEN events once the app is fully wired — no import-time IO.
    app.addHook('onReady', async () => {
      await events.boot()
    })

    app.addHook('onClose', async () => {
      events.shutdown()
    })
  },
  { name: 'events-runtime', dependencies: ['prisma', 'redis'] },
)

declare module 'fastify' {
  interface FastifyInstance {
    bus: Bus
    events: EventRegistry
  }
}
