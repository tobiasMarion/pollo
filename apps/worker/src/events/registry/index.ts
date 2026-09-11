import { controlMessageSchema, ingestBatchSchema, streamKeys } from '@pollo/contracts'
import type { Origin } from '@pollo/geometry'
import type { Logger } from '../../config/logger/index.js'
import type { StreamEntry, StreamReader } from '../../redis/reader/index.js'
import type { RecoverySource } from '../../redis/recovery/index.js'
import type { LiveEvent } from '../live-event/index.js'

export interface EventRegistryOptions {
  reader: StreamReader
  recovery: RecoverySource
  logger: Logger
  tickMs: number
  /**
   * How an event is assembled. The registry knows when an event opens and what
   * its origin is; what a solved event is made of is the composition root's
   * business, and putting it here would drag every knob in the worker through a
   * class whose whole job is a map and a timer.
   */
  createEvent: (eventId: string, origin: Origin) => LiveEvent
}

/**
 * Which events are live, and the clock that solves them.
 *
 * Startup takes a cursor before reading the authoritative open-event and graph
 * snapshots. Any mutation racing that recovery is therefore present in the
 * snapshot or waiting after the cursor. Streams describe change; state keys
 * describe what survived before this process arrived.
 */
export class EventRegistry {
  private readonly events = new Map<string, LiveEvent>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly options: EventRegistryOptions) {}

  get size() {
    return this.events.size
  }

  async start() {
    // Cursor first, snapshot second. Anything racing recovery is either in the
    // snapshot or waiting after the cursor, never lost in the gap between them.
    await this.options.reader.follow(streamKeys.control(), 'latest')

    for (const { eventId, origin } of await this.options.recovery.openEvents()) {
      await this.open(eventId, origin)
    }

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
  readonly handle = async (entry: StreamEntry) => {
    if (entry.key === streamKeys.control()) {
      await this.handleControl(entry)
      return
    }

    this.handleIngest(entry)
  }

  private async handleControl(entry: StreamEntry) {
    const parsed = controlMessageSchema.safeParse(entry.payload)

    if (!parsed.success) {
      this.options.logger.error({ issues: parsed.error.issues }, 'invalid control message')
      return
    }

    if (parsed.data.op === 'EVENT_OPENED') {
      // The API emits OPENED again after a process restart. That is a new
      // runtime generation: its old sockets are gone and its graph snapshot
      // has already been cleared, so replace rather than ignore this event.
      if (this.events.delete(parsed.data.eventId)) {
        this.options.reader.unfollow(streamKeys.ingest(parsed.data.eventId))
      }
      await this.open(parsed.data.eventId, {
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

  private async open(eventId: string, origin: Origin) {
    if (this.events.has(eventId)) return

    this.events.set(eventId, this.options.createEvent(eventId, origin))

    // Only what happens from here. Whatever the ingest stream still holds is a
    // window that was already applied to a graph this process does not have, and
    // replaying an event's whole history to learn its current shape would be
    // paying for the past to describe the present.
    await this.options.reader.follow(streamKeys.ingest(eventId), 'latest')

    const event = this.events.get(eventId)
    const recovered = await this.options.recovery.graph(eventId)

    if (event && recovered.length > 0) event.ingest({ at: Date.now(), ops: recovered })

    this.options.logger.info(
      { eventId, live: this.events.size, recovered: recovered.length },
      'event opened',
    )
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
