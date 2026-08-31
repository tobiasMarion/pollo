import { createRegistry } from './composition/index.js'
import { loadEnv } from './config/env/index.js'
import { createLogger } from './config/logger/index.js'
import { closeRedis, createRedis } from './redis/client/index.js'

const env = loadEnv()
const logger = createLogger(env)
const redis = createRedis(env)

const registry = createRegistry(env, logger, redis)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, 'shutting down')

    await registry.stop()
    await closeRedis(redis)

    process.exit(0)
  })
}

try {
  await registry.start()
  logger.info({ tickMs: env.WORKER_TICK_MS }, 'worker running')
} catch (error) {
  logger.error(error)
  process.exit(1)
}
