import {
  type PositionPoint,
  type PositionsMessage,
  STREAM_FIELD,
  streamKeys,
} from '@pollo/contracts'
import type { Redis } from 'ioredis'
import type { Logger } from '../config/logger.js'

export interface PublisherOptions {
  maxlen: number
  pointsPerMessage: number
}

/**
 * Writes solved positions back to the API.
 *
 * Two limits, both learned from the ingest stream going the other way. **MAXLEN**,
 * because a stream nobody trims is a memory leak with a schedule: the API reads
 * these entries as they arrive and never replays them, so keeping a thousand is
 * already generous. And a **cap on points per entry**, because a keyframe is
 * every pixel in the event — at fifty thousand phones that is one multi-megabyte
 * `XADD` blocking the server for everybody.
 */
export class PositionPublisher {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly options: PublisherOptions,
  ) {}

  publish(eventId: string, kind: PositionsMessage['kind'], points: readonly PositionPoint[]) {
    if (points.length === 0) return

    const key = streamKeys.positions(eventId)

    for (let start = 0; start < points.length; start += this.options.pointsPerMessage) {
      const message: PositionsMessage = {
        kind,
        points: points.slice(start, start + this.options.pointsPerMessage),
      }

      // Fire and forget: the tick owes the crowd its next solve, not a round
      // trip. A lost entry is reconciled by the next keyframe.
      this.redis
        .xadd(key, 'MAXLEN', '~', this.options.maxlen, '*', STREAM_FIELD, JSON.stringify(message))
        .catch(error => {
          this.logger.error({ err: error, eventId, kind }, 'failed to publish positions')
        })
    }
  }
}
