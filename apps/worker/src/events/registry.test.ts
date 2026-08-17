import { randomUUID } from 'node:crypto'
import {
  type ControlMessage,
  type IngestBatch,
  type Location,
  type PositionsMessage,
  positionsMessageSchema,
  STREAM_FIELD,
  streamKeys,
} from '@pollo/contracts'
import type { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../config/logger.js'
import { PositionPublisher } from '../redis/publisher.js'
import { StreamReader } from '../redis/reader.js'
import { EventRegistry } from './registry.js'

const logger = createLogger({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  REDIS_URL: 'redis://localhost:6379',
  WORKER_TICK_MS: 33,
  WORKER_POSITIONS_MAXLEN: 1_000,
  WORKER_POINTS_PER_MESSAGE: 500,
  WORKER_KEYFRAME_TICKS: 90,
  WORKER_PUBLISH_EPSILON_M: 0.05,
})

const origin = { latitude: -29.6842, longitude: -53.8069 }

function location(partial: Partial<Location> = {}): Location {
  return {
    latitude: origin.latitude,
    longitude: origin.longitude,
    altitude: 100,
    horizontalAccuracy: 5,
    verticalAccuracy: 12,
    ...partial,
  }
}

/** Polls until `check` passes, because the reader lives on its own loop. */
async function until(check: () => boolean | Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }

  throw new Error('timed out waiting for the worker to catch up')
}

describe('EventRegistry', () => {
  let redis: Redis
  let registry: EventRegistry

  beforeEach(async () => {
    // ioredis-mock instances share one keyspace, so every run gets its own ids.
    redis = new RedisMock() as unknown as Redis

    registry = new EventRegistry({
      reader: new StreamReader(redis, logger, { blockMs: 20, connection: redis }),
      publisher: new PositionPublisher(redis, logger, { maxlen: 1_000, pointsPerMessage: 500 }),
      logger,
      tickMs: 5,
      keyframeTicks: 90,
      epsilon: 0.05,
    })

    await registry.start()
  })

  afterEach(async () => {
    await registry.stop()
  })

  async function publishControl(message: ControlMessage) {
    await redis.xadd(streamKeys.control(), '*', STREAM_FIELD, JSON.stringify(message))
  }

  async function publishIngest(eventId: string, batch: IngestBatch) {
    await redis.xadd(streamKeys.ingest(eventId), '*', STREAM_FIELD, JSON.stringify(batch))
  }

  async function readPositions(eventId: string): Promise<PositionsMessage[]> {
    const entries = (await redis.xrange(streamKeys.positions(eventId), '-', '+')) as Array<
      [string, string[]]
    >

    return entries.map(([, fields]) => {
      const index = fields.indexOf(STREAM_FIELD)

      return positionsMessageSchema.parse(JSON.parse(fields[index + 1] ?? '{}'))
    })
  }

  it('picks up an event from the control stream', async () => {
    await publishControl({ op: 'EVENT_OPENED', eventId: randomUUID(), ...origin })

    await until(() => registry.size === 1)
  })

  it('drops an event when it closes', async () => {
    const eventId = randomUUID()

    await publishControl({ op: 'EVENT_OPENED', eventId, ...origin })
    await until(() => registry.size === 1)

    await publishControl({ op: 'EVENT_CLOSED', eventId })
    await until(() => registry.size === 0)
  })

  /**
   * The whole path, and the reason this suite exists: a device joining over
   * Redis comes back out as a position on the other stream, with nothing but
   * the contract in between.
   */
  it('turns an arrival into a published position', async () => {
    const eventId = randomUUID()

    await publishControl({ op: 'EVENT_OPENED', eventId, ...origin })
    await until(() => registry.size === 1)

    await publishIngest(eventId, {
      at: Date.now(),
      ops: [{ op: 'JOIN', deviceId: 'device-1', location: location({ altitude: 117 }) }],
    })

    let messages: PositionsMessage[] = []

    await until(async () => {
      messages = await readPositions(eventId)
      return messages.some(message => message.points.length > 0)
    })

    const point = messages.flatMap(message => message.points).find(p => p.deviceId === 'device-1')

    expect(point).toBeDefined()
    expect(point?.position.simulated.relative.z).toBe(117)
  })

  it('says nothing about an event it was never told about', async () => {
    const eventId = randomUUID()

    await publishIngest(eventId, {
      at: Date.now(),
      ops: [{ op: 'JOIN', deviceId: 'device-1', location: location() }],
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(await readPositions(eventId)).toHaveLength(0)
  })
})
