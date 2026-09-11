import { randomUUID } from 'node:crypto'
import { stateKeys, streamKeys } from '@pollo/contracts'
import type { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../config/env.js'
import { createLogger } from '../../config/logger.js'
import { RedisStreamsBus } from './bus.js'

const logger = createLogger(
  loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-secret-long-enough',
    GITHUB_OAUTH_CLIENT_ID: 'test',
    GITHUB_OAUTH_CLIENT_SECRET: 'test',
    GITHUB_OAUTH_CLIENT_REDIRECT_URI: 'http://localhost/callback',
  }),
)

describe('RedisStreamsBus', () => {
  let redis: Redis
  let bus: RedisStreamsBus

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis
    await redis.flushall()
    bus = new RedisStreamsBus(redis, logger)
  })

  it('changes the recovery state in the same transaction as lifecycle news', async () => {
    const eventId = randomUUID()
    const opened = {
      op: 'EVENT_OPENED' as const,
      eventId,
      latitude: -29.7,
      longitude: -53.7,
    }

    await bus.publishControl(opened)

    expect(JSON.parse((await redis.hget(stateKeys.openEvents(), eventId)) ?? '{}')).toEqual({
      latitude: opened.latitude,
      longitude: opened.longitude,
    })
    expect(await redis.xlen(streamKeys.control())).toBe(1)

    await bus.publishControl({ op: 'EVENT_CLOSED', eventId })

    expect(await redis.hget(stateKeys.openEvents(), eventId)).toBeNull()
    expect(await redis.xlen(streamKeys.control())).toBe(2)
  })
})
