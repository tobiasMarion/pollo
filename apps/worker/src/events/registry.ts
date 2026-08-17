import { controlMessageSchema, ingestBatchSchema, streamKeys } from '@pollo/contracts'
import type { Logger } from '../config/logger.js'
import type { PositionPublisher } from '../redis/publisher.js'
import type { StreamEntry, StreamReader } from '../redis/reader.js'
import { LiveEvent } from './live-event.js'

export interface EventRegistryOptions {
  reader: StreamReader
  publisher: PositionPublisher
  logger: Logger
  tickMs: number
  keyframeTicks: number
  epsilon: number
}

/**
 * Which events are live, and the clock that solves them.
 *
 * The control stream is read from the very beginning rather than from now.
 * `EVENT_OPENED` and `EVENT_CLOSED` are the only things on it — two entries per
 * event in the lifetime of the system — so replaying it is cheap, and folding
 * the pair tells a worker that has just started which events are open without
 * asking anybody. A worker that anchored at the end would learn nothing until
 * the next event opened.
 */
export class EventRegistry {
  private readonly events = new Map<string, LiveEvent>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly options: EventRegistryOptions) {}

  get size() {
    return this.events.size
  }

  async start() {
    await this.options.reader.follow(streamKeys.control(), '0')

    this.options.reader.start(this.handle)

    this.timer = setInterval(() => this.tick(), this.options.tickMs)
    this.timer.unref?.()
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null

    await this.options.reader.stop()
    this.events.clear()
  }

  /** Routes one stream entry by the key it arrived on. */
  readonly handle = (entry: StreamEntry) => {
    if (entry.key === streamKeys.control()) {
      this.handleControl(entry)
      return
    }

    this.handleIngest(entry)
  }

  private handleControl(entry: StreamEntry) {
    const parsed = controlMessageSchema.safeParse(entry.payload)

    if (!parsed.success) {
      this.options.logger.error({ issues: parsed.error.issues }, 'invalid control message')
      return
    }

    if (parsed.data.op === 'EVENT_OPENED') {
      void this.open(parsed.data.eventId, {
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
      })
      return
    }

    this.close(parsed.data.eventId)
  }

  private handleIngest(entry: StreamEntry) {
    const eventId = this.eventIdOf(entry.key)
    const event = eventId === undefined ? undefined : this.events.get(eventId)

    // An ingest entry for an event this worker does not hold is not an error
    // worth logging per window: closing an event and its last window racing past
    // each other is normal, and the stream key outlives the event.
    if (!event) return

    const parsed = ingestBatchSchema.safeParse(entry.payload)

    if (!parsed.success) {
      this.options.logger.error({ issues: parsed.error.issues, eventId }, 'invalid ingest batch')
      return
    }

    event.ingest(parsed.data)
  }

  private eventIdOf(key: string) {
    // `event:<uuid>:ingest`, and a uuid has no colons in it.
    const parts = key.split(':')

    return parts.length === 3 && parts[2] === 'ingest' ? parts[1] : undefined
  }

  private async open(eventId: string, origin: { latitude: number; longitude: number }) {
    if (this.events.has(eventId)) return

    this.events.set(
      eventId,
      new LiveEvent({
        eventId,
        origin,
        publisher: this.options.publisher,
        keyframeTicks: this.options.keyframeTicks,
        epsilon: this.options.epsilon,
      }),
    )

    // Only what happens from here. Whatever the ingest stream still holds is a
    // window that was already applied to a graph this process does not have, and
    // replaying an event's whole history to learn its current shape would be
    // paying for the past to describe the present.
    await this.options.reader.follow(streamKeys.ingest(eventId), 'latest')

    this.options.logger.info({ eventId, live: this.events.size }, 'event opened')
  }

  private close(eventId: string) {
    if (!this.events.delete(eventId)) return

    this.options.reader.unfollow(streamKeys.ingest(eventId))
    this.options.logger.info({ eventId, live: this.events.size }, 'event closed')
  }

  private tick() {
    for (const event of this.events.values()) event.tick()
  }
}
