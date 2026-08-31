import { STREAM_FIELD } from '@pollo/contracts'
import type { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../config/env/index.js'
import { createLogger } from '../../config/logger/index.js'
import { type StreamEntry, StreamReader } from './index.js'

const logger = createLogger(
  loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', REDIS_URL: 'redis://localhost:6379' }),
)

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function until(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (check()) return
    await sleep(5)
  }

  throw new Error('timed out waiting for the reader')
}

describe('StreamReader', () => {
  let reader: StreamReader | null = null

  afterEach(async () => {
    await reader?.stop()
    reader = null
  })

  it('delivers what a followed stream carries, unwrapped', async () => {
    const redis = new RedisMock() as unknown as Redis
    const seen: StreamEntry[] = []

    reader = new StreamReader(redis, logger, { blockMs: 20, connection: redis })
    await reader.follow('stream:a', '0')
    reader.start(entry => {
      seen.push(entry)
    })

    await redis.xadd('stream:a', '*', STREAM_FIELD, JSON.stringify({ hello: 'world' }))

    await until(() => seen.length === 1)

    expect(seen[0]?.key).toBe('stream:a')
    expect(seen[0]?.payload).toEqual({ hello: 'world' })
  })

  // Where a read *starts* — `follow(key, 'latest')` against `follow(key, '0')` —
  // is not asserted here. `ioredis-mock` hands back the entry at the cursor
  // rather than the ones after it, so those tests would pass or fail for reasons
  // that have nothing to do with this file. They live in
  // `test/integration/reader.test.ts`, against a Redis that implements XREAD.

  /**
   * Handling an entry can mean going back to Redis — an event opening has to
   * resolve its ingest stream's baseline before the read is rebuilt. If the next
   * entry were looked at meanwhile, an event that opened and closed inside one
   * reply would be closed before it was open, and its stream followed forever.
   */
  it('finishes handling one entry before it looks at the next', async () => {
    const redis = new RedisMock() as unknown as Redis
    const order: string[] = []
    let inFlight = 0
    let overlapped = false

    reader = new StreamReader(redis, logger, { blockMs: 20, connection: redis })
    await reader.follow('stream:c', '0')

    reader.start(async entry => {
      if (inFlight > 0) overlapped = true
      inFlight++

      const payload = entry.payload as { n: number }

      // The first entry takes its time, the way a `follow` would.
      await sleep(payload.n === 1 ? 40 : 0)
      order.push(String(payload.n))

      inFlight--
    })

    await redis.xadd('stream:c', '*', STREAM_FIELD, JSON.stringify({ n: 1 }))
    await redis.xadd('stream:c', '*', STREAM_FIELD, JSON.stringify({ n: 2 }))

    await until(() => order.length === 2)

    expect(order).toEqual(['1', '2'])
    expect(overlapped).toBe(false)
  })

  it('moves past an entry it cannot read rather than stalling on it', async () => {
    const redis = new RedisMock() as unknown as Redis
    const seen: StreamEntry[] = []

    reader = new StreamReader(redis, logger, { blockMs: 20, connection: redis })
    await reader.follow('stream:d', '0')
    reader.start(entry => {
      seen.push(entry)
    })

    await redis.xadd('stream:d', '*', STREAM_FIELD, 'not json at all')
    await redis.xadd('stream:d', '*', STREAM_FIELD, JSON.stringify({ ok: true }))

    await until(() => seen.length === 1)

    expect(seen[0]?.payload).toEqual({ ok: true })
  })

  it('stops following a stream it was told to drop', async () => {
    const redis = new RedisMock() as unknown as Redis
    const seen: StreamEntry[] = []

    reader = new StreamReader(redis, logger, { blockMs: 20, connection: redis })
    await reader.follow('stream:e', '0')
    reader.start(entry => {
      seen.push(entry)
    })

    await redis.xadd('stream:e', '*', STREAM_FIELD, JSON.stringify({ n: 1 }))
    await until(() => seen.length === 1)

    reader.unfollow('stream:e')

    await redis.xadd('stream:e', '*', STREAM_FIELD, JSON.stringify({ n: 2 }))
    await sleep(80)

    expect(seen).toHaveLength(1)
  })
})
