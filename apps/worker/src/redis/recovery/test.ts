import { stateKeys } from '@pollo/contracts'
import type { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../config/env/index.js'
import { createLogger } from '../../config/logger/index.js'
import { RecoveryReader } from './index.js'

const logger = createLogger(
  loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', REDIS_URL: 'redis://localhost:6379' }),
)

describe('RecoveryReader', () => {
  let redis: Redis
  let recovery: RecoveryReader

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis
    await redis.flushall()
    recovery = new RecoveryReader(redis, logger)
  })

  it('reads the current open events rather than their stream history', async () => {
    await redis.hset(
      stateKeys.openEvents(),
      'event-1',
      JSON.stringify({ latitude: -29.7, longitude: -53.7 }),
    )

    expect(await recovery.openEvents()).toEqual([
      { eventId: 'event-1', origin: { latitude: -29.7, longitude: -53.7 } },
    ])
  })

  it('turns the stored graph into one idempotent ingest snapshot', async () => {
    const keys = stateKeys.graph('event-1')
    const location = {
      latitude: -29.7,
      longitude: -53.7,
      altitude: 100,
      horizontalAccuracy: 5,
      verticalAccuracy: 8,
    }

    await redis.hset(keys.locations, 'a', JSON.stringify(location), 'b', JSON.stringify(location))
    await redis.hset(keys.edgesFrom('a'), 'b', '3.2')

    expect(await recovery.graph('event-1')).toEqual([
      { op: 'JOIN', deviceId: 'a', location },
      { op: 'JOIN', deviceId: 'b', location },
      { op: 'DISTANCE', from: 'a', to: 'b', distance: 3.2 },
    ])
  })

  it('drops malformed state instead of taking the worker down', async () => {
    await redis.hset(stateKeys.openEvents(), 'broken', '{')
    await redis.hset(stateKeys.graph('event-1').locations, 'broken', '{}')

    expect(await recovery.openEvents()).toEqual([])
    expect(await recovery.graph('event-1')).toEqual([])
  })
})
