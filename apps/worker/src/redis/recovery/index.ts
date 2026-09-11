import { type IngestMessage, locationSchema, stateKeys } from '@pollo/contracts'
import type { Origin } from '@pollo/geometry'
import type { Redis } from 'ioredis'
import { z } from 'zod'
import type { Logger } from '../../config/logger/index.js'

const originSchema = z.object({ latitude: z.number(), longitude: z.number() })

export interface RecoverableEvent {
  eventId: string
  origin: Origin
}

export interface RecoverySource {
  openEvents(): Promise<RecoverableEvent[]>
  graph(eventId: string): Promise<IngestMessage[]>
}

/**
 * Reads the compact current state that accompanies the streams.
 *
 * Recovery always captures a stream cursor before calling this reader. Any
 * write racing the snapshot is therefore either visible here or waiting after
 * that cursor, and applying it twice is harmless.
 */
export class RecoveryReader implements RecoverySource {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async openEvents(): Promise<RecoverableEvent[]> {
    const entries = await this.redis.hgetall(stateKeys.openEvents())
    const events: RecoverableEvent[] = []

    for (const [eventId, json] of Object.entries(entries)) {
      const origin = this.parse(json, originSchema, { eventId, state: 'open event' })

      if (origin) events.push({ eventId, origin })
    }

    return events
  }

  async graph(eventId: string): Promise<IngestMessage[]> {
    const keys = stateKeys.graph(eventId)
    const locations = await this.redis.hgetall(keys.locations)
    const deviceIds = Object.keys(locations)
    const pipeline = this.redis.pipeline()

    for (const deviceId of deviceIds) pipeline.hgetall(keys.edgesFrom(deviceId))

    const edgeResults = (await pipeline.exec()) ?? []
    const ops: IngestMessage[] = []

    for (const [deviceId, json] of Object.entries(locations)) {
      const location = this.parse(json, locationSchema, { eventId, deviceId, state: 'location' })

      if (location) ops.push({ op: 'JOIN', deviceId, location })
    }

    deviceIds.forEach((from, index) => {
      const [error, rawEdges] = edgeResults[index] ?? []
      if (error) {
        this.logger.error({ err: error, eventId, from }, 'failed to recover graph edges')
        return
      }

      for (const [to, rawDistance] of Object.entries(rawEdges as Record<string, string>)) {
        const distance = Number.parseFloat(rawDistance)

        if (Number.isFinite(distance)) ops.push({ op: 'DISTANCE', from, to, distance })
      }
    })

    return ops
  }

  private parse<Schema extends z.ZodTypeAny>(
    json: string,
    schema: Schema,
    context: Record<string, unknown>,
  ): z.infer<Schema> | undefined {
    let value: unknown

    try {
      value = JSON.parse(json)
    } catch {
      this.logger.error(context, 'recovery state is not valid JSON')
      return undefined
    }

    const parsed = schema.safeParse(value)

    if (!parsed.success) {
      this.logger.error({ ...context, issues: parsed.error.issues }, 'recovery state is invalid')
      return undefined
    }

    return parsed.data
  }
}
