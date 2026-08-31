import { randomUUID } from 'node:crypto'
import { STREAM_FIELD } from '@pollo/contracts'
import { Redis } from 'ioredis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../src/config/env/index.js'
import { createLogger } from '../../src/config/logger/index.js'
import { type StreamEntry, StreamReader } from '../../src/redis/reader/index.js'

const REDIS_URL = process.env.WORKER_TEST_REDIS_URL ?? 'redis://localhost:6379/15'

const logger = createLogger(
  loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', REDIS_URL: 'redis://localhost:6379' }),
)

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(check: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (check()) return
    await sleep(10)
  }

  throw new Error('timed out waiting for the reader')
}

/**
 * Where a read starts is the difference between a worker that follows an event
 * and one that replays its history, and it is exactly what `ioredis-mock` gets
 * wrong — its `XREAD` hands back the entry at the cursor rather than the ones
 * after it. So this tier asks a real Redis.
 */
describe('StreamReader against a real Redis', () => {
  let redis: Redis
  let reader: StreamReader | null = null
  let key: string

  beforeEach(() => {
    redis = new Redis(REDIS_URL)
    key = `worker-test:${randomUUID()}`
  })

  afterEach(async () => {
    await reader?.stop()
    reader = null

    await redis.del(key)
    await redis.quit()
  })

  it('skips what a stream already holds when asked for the latest', async () => {
    const seen: StreamEntry[] = []

    await redis.xadd(key, '*', STREAM_FIELD, JSON.stringify({ n: 'old' }))

    reader = new StreamReader(redis, logger, { blockMs: 50 })
    await reader.follow(key, 'latest')
    reader.start(entry => {
      seen.push(entry)
    })

    await redis.xadd(key, '*', STREAM_FIELD, JSON.stringify({ n: 'new' }))

    await until(() => seen.length > 0)
    await sleep(150)

    expect(seen.map(entry => entry.payload)).toEqual([{ n: 'new' }])
  })

  it('replays what a stream already holds when asked from the beginning', async () => {
    const seen: StreamEntry[] = []

    await redis.xadd(key, '*', STREAM_FIELD, JSON.stringify({ n: 'old' }))

    reader = new StreamReader(redis, logger, { blockMs: 50 })
    await reader.follow(key, '0')
    reader.start(entry => {
      seen.push(entry)
    })

    await redis.xadd(key, '*', STREAM_FIELD, JSON.stringify({ n: 'new' }))

    await until(() => seen.length === 2)

    expect(seen.map(entry => entry.payload)).toEqual([{ n: 'old' }, { n: 'new' }])
  })

  /**
   * The reader holds a socket of its own precisely so that following a new
   * stream — which happens on a connection the loop is not blocked on — does not
   * have to wait for the current read to come back.
   */
  it('picks up a stream that starts being followed after the read began', async () => {
    const seen: StreamEntry[] = []
    const second = `${key}:second`

    reader = new StreamReader(redis, logger, { blockMs: 50 })
    await reader.follow(key, 'latest')
    reader.start(entry => {
      seen.push(entry)
    })

    await sleep(80)
    await reader.follow(second, 'latest')
    await redis.xadd(second, '*', STREAM_FIELD, JSON.stringify({ n: 'later' }))

    await until(() => seen.length === 1)
    await redis.del(second)

    expect(seen[0]?.key).toBe(second)
  })

  it('delivers nothing more from a stream it stopped following', async () => {
    const seen: StreamEntry[] = []

    reader = new StreamReader(redis, logger, { blockMs: 50 })
    await reader.follow(key, 'latest')
    reader.start(entry => {
      seen.push(entry)
    })

    await redis.xadd(key, '*', STREAM_FIELD, JSON.stringify({ n: 1 }))
    await until(() => seen.length === 1)

    reader.unfollow(key)

    await redis.xadd(key, '*', STREAM_FIELD, JSON.stringify({ n: 2 }))
    await sleep(200)

    expect(seen).toHaveLength(1)
  })
})
