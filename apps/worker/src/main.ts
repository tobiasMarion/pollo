import { loadEnv } from './config/env.js'
import { createLogger } from './config/logger.js'
import { EventRegistry } from './events/registry.js'
import { closeRedis, createRedis } from './redis/client.js'
import { PositionPublisher } from './redis/publisher.js'
import { StreamReader } from './redis/reader.js'

const env = loadEnv()
const logger = createLogger(env)
const redis = createRedis(env)

const registry = new EventRegistry({
  reader: new StreamReader(redis, logger),
  publisher: new PositionPublisher(redis, logger, {
    maxlen: env.WORKER_POSITIONS_MAXLEN,
    pointsPerMessage: env.WORKER_POINTS_PER_MESSAGE,
  }),
  logger,
  tickMs: env.WORKER_TICK_MS,
  keyframeTicks: env.WORKER_KEYFRAME_TICKS,
  epsilon: env.WORKER_PUBLISH_EPSILON_M,
  minDegree: env.WORKER_MIN_DEGREE,
  solver: {
    anchor: { scale: env.WORKER_ANCHOR_SCALE },
    huberKnee: env.WORKER_HUBER_KNEE,
    sweepsPerTick: env.WORKER_SWEEPS_PER_TICK,
    convergenceM: env.WORKER_CONVERGENCE_M,
    omega: env.WORKER_OMEGA,
    alphaMin: env.WORKER_ALPHA_MIN,
    scaleBlend: 0.2,
    samplingStride: 7,
  },
})

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
