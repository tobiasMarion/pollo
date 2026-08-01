import fastifyPlugin from 'fastify-plugin'
import { Redis } from 'ioredis'

export interface RedisPluginOptions {
  client?: Redis
  url?: string
}

export const redisPlugin = fastifyPlugin<RedisPluginOptions>(
  async (app, options) => {
    const redis = options.client ?? new Redis(options.url ?? app.env.REDIS_URL)

    app.decorate('redis', redis)

    app.addHook('onClose', async () => {
      // quit() waits for pending replies; fall back to disconnect on failure.
      await redis.quit().catch(() => redis.disconnect())
    })
  },
  { name: 'redis' },
)

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}
