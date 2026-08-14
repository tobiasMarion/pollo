import fastifyWebsocket from '@fastify/websocket'
import fastifyPlugin from 'fastify-plugin'
import { Heartbeat } from '../http/ws/heartbeat.js'

/** Well above the largest frame the protocol produces, and below interesting. */
const MAX_PAYLOAD_BYTES = 16 * 1024

export const websocketPlugin = fastifyPlugin(
  async app => {
    await app.register(fastifyWebsocket, {
      options: {
        // Asserted rather than assumed: a zlib context per connection is the
        // difference between a load test and a memory graph.
        perMessageDeflate: false,
        // JSON.parse validates the same bytes a moment later.
        skipUTF8Validation: true,
        maxPayload: MAX_PAYLOAD_BYTES,
      },
    })

    const heartbeat = new Heartbeat()

    app.decorate('heartbeat', heartbeat)
    app.metrics.gauge('watchedSockets', () => heartbeat.size)

    app.addHook('onClose', async () => {
      heartbeat.stop()
    })
  },
  { name: 'websocket', dependencies: ['metrics'] },
)

declare module 'fastify' {
  interface FastifyInstance {
    heartbeat: Heartbeat
  }
}
