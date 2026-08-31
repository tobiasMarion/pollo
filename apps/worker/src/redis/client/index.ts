import { Redis } from 'ioredis'
import type { Env } from '../../config/env/index.js'

export function createRedis(env: Env) {
  return new Redis(env.REDIS_URL, {
    // Commands issued in the same tick leave as one write.
    enableAutoPipelining: true,
  })
}

export async function closeRedis(redis: Redis) {
  await redis.quit().catch(() => redis.disconnect())
}
