import { STREAM_FIELD } from '@pollo/contracts'
import type { Redis } from 'ioredis'
import type { Logger } from '../config/logger.js'

/** What arrived on one stream, already unwrapped from the entry envelope. */
export interface StreamEntry {
  key: string
  id: string
  payload: unknown
}

export type EntryHandler = (entry: StreamEntry) => void

const RETRY_DELAY_MS = 500

/**
 * Follows every stream the worker cares about on **one** connection.
 *
 * The obvious shape — a blocking read per event — is the one that does not
 * scale: `XREAD BLOCK` monopolises its socket, so a hundred live events would
 * be a hundred connections doing nothing. A single read over every key costs
 * one connection whatever the crowd does, and Redis delivers from all of them
 * in the same reply.
 *
 * Streams are followed from a **resolved id**, never from `'$'`. `'$'` means
 * "whatever is latest when this call starts", so anything published between one
 * read returning and the next one starting would be dropped — a gap per loop
 * iteration rather than a one-off.
 */
export class StreamReader {
  private readonly cursors = new Map<string, string>()
  private readonly connection: Redis
  private running = false
  private loop: Promise<void> | null = null

  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly blockMs = 1_000,
  ) {
    this.connection = redis.duplicate()
  }

  /**
   * Adds a stream to the read.
   *
   * `from` is `'0'` to replay everything the stream still holds, or `'latest'`
   * to start after whatever is there now — resolved here, through the already
   * connected client, rather than left as `'$'` for the reader to interpret.
   */
  async follow(key: string, from: '0' | 'latest') {
    if (this.cursors.has(key)) return

    this.cursors.set(key, from === '0' ? '0' : await this.latestId(key))
  }

  unfollow(key: string) {
    this.cursors.delete(key)
  }

  private async latestId(key: string) {
    try {
      const last = (await this.redis.xrevrange(key, '+', '-', 'COUNT', 1)) as Array<
        [string, string[]]
      >

      return last[0]?.[0] ?? '0'
    } catch (error) {
      // Replaying is the safe failure: ingest ops are idempotent, so seeing a
      // window twice costs a little work and changes nothing.
      this.logger.error({ err: error, key }, 'failed to resolve stream baseline; replaying')

      return '0'
    }
  }

  start(onEntry: EntryHandler) {
    if (this.running) return

    this.running = true
    this.loop = this.run(onEntry)
  }

  async stop() {
    this.running = false
    this.connection.disconnect()

    await this.loop
    this.loop = null
  }

  private async run(onEntry: EntryHandler) {
    while (this.running) {
      const keys = [...this.cursors.keys()]

      // Nothing to follow yet: the first event has not opened. Waiting on an
      // empty XREAD is an error, so wait on the clock instead.
      if (keys.length === 0) {
        await sleep(this.blockMs)
        continue
      }

      try {
        const ids = keys.map(key => this.cursors.get(key) ?? '0')

        const response = (await this.connection.xread(
          'BLOCK',
          this.blockMs,
          'STREAMS',
          ...keys,
          ...ids,
        )) as Array<[string, Array<[string, string[]]>]> | null

        if (!response) continue

        for (const [key, entries] of response) {
          for (const [id, fields] of entries) {
            // Advance before handling: a payload this worker cannot parse is
            // still a payload it has seen, and re-reading it forever would
            // stall the stream on one bad entry.
            this.cursors.set(key, id)

            const payload = this.unwrap(key, id, fields)

            if (payload !== undefined) onEntry({ key, id, payload })
          }
        }
      } catch (error) {
        if (!this.running) break

        this.logger.error({ err: error }, 'stream read failed; retrying')
        await sleep(RETRY_DELAY_MS)
      }
    }
  }

  private unwrap(key: string, id: string, fields: string[]) {
    const index = fields.indexOf(STREAM_FIELD)
    const json = index === -1 ? undefined : fields[index + 1]

    if (json === undefined) {
      this.logger.error({ key, id }, 'stream entry carries no payload')
      return undefined
    }

    try {
      return JSON.parse(json) as unknown
    } catch {
      this.logger.error({ key, id }, 'stream entry is not valid JSON')
      return undefined
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
