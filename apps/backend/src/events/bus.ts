import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import {
  type ControlMessage,
  type IngestMessage,
  type PositionsMessage,
  positionsMessageSchema,
  STREAM_FIELD,
  streamKeys,
} from '../schemas/wire.js';

export interface PositionsSubscription {
  stop(): void;
}

/**
 * Transport port between the API and the simulation worker (ADR 0001: the
 * broker choice is deferred, so all transport details live behind this
 * interface). The Redis Streams implementation below is the current default.
 */
export interface Bus {
  /** Graph mutations, per event (Node -> worker). Fire-and-forget. */
  publishIngest(eventId: string, message: IngestMessage): void;
  /** Event lifecycle announcements (Node -> worker). Fire-and-forget. */
  publishControl(message: ControlMessage): void;
  /** Position updates computed by the worker (worker -> Node). */
  subscribePositions(
    eventId: string,
    onMessage: (message: PositionsMessage) => void,
  ): PositionsSubscription;
}

const RETRY_DELAY_MS = 500;

export class RedisStreamsBus implements Bus {
  constructor(
    private readonly redis: Redis,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /** The hot IO path must never block waiting on Redis. */
  private fireAndForget(promise: Promise<unknown>, context: string) {
    promise.catch((error) => {
      this.logger.error({ err: error, context }, 'failed to publish to stream');
    });
  }

  publishIngest(eventId: string, message: IngestMessage) {
    this.fireAndForget(
      this.redis.xadd(streamKeys.ingest(eventId), '*', STREAM_FIELD, JSON.stringify(message)),
      `ingest:${message.op}`,
    );
  }

  publishControl(message: ControlMessage) {
    this.fireAndForget(
      this.redis.xadd(streamKeys.control(), '*', STREAM_FIELD, JSON.stringify(message)),
      `control:${message.op}`,
    );
  }

  /**
   * Consumes the positions stream with a dedicated connection (XREAD BLOCK
   * monopolizes the socket). Last-write-wins per pixel: missed deltas are
   * harmless — the periodic keyframe reconciles state.
   */
  subscribePositions(eventId: string, onMessage: (message: PositionsMessage) => void) {
    const connection = this.redis.duplicate();
    const key = streamKeys.positions(eventId);
    let running = true;

    const loop = async () => {
      // '$' would only anchor once the duplicated connection finishes its
      // handshake — entries published in that window would be silently lost.
      // Snapshot the baseline through the main (already connected) client so
      // "everything after subscribe()" is what actually gets delivered.
      let lastId = await this.resolveBaselineId(key);

      while (running) {
        try {
          const response = (await connection.xread('BLOCK', 5000, 'STREAMS', key, lastId)) as Array<
            [string, Array<[string, string[]]>]
          > | null;

          if (!response) continue;

          for (const [, entries] of response) {
            for (const [id, fields] of entries) {
              lastId = id;
              this.logger.debug({ eventId, entryId: id }, 'positions entry received');
              this.handleEntry(fields, onMessage);
            }
          }
        } catch (error) {
          if (!running) break;
          this.logger.error({ err: error, eventId }, 'positions consumer failed; retrying');
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    };

    void loop();

    return {
      stop: () => {
        running = false;
        connection.disconnect();
      },
    };
  }

  private async resolveBaselineId(key: string): Promise<string> {
    try {
      const latest = (await this.redis.xrevrange(key, '+', '-', 'COUNT', 1)) as Array<
        [string, string[]]
      >;
      return latest[0]?.[0] ?? '0';
    } catch (error) {
      this.logger.error({ err: error, key }, 'failed to resolve stream baseline; replaying');
      // Replaying from the start is safe: positions are last-write-wins and
      // keyframes reconcile any stale delta.
      return '0';
    }
  }

  private handleEntry(fields: string[], onMessage: (message: PositionsMessage) => void) {
    const fieldIndex = fields.indexOf(STREAM_FIELD);
    if (fieldIndex === -1) return;

    const json = fields[fieldIndex + 1];
    if (json === undefined) return;

    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      this.logger.error({ json }, 'positions entry is not valid JSON');
      return;
    }

    const parsed = positionsMessageSchema.safeParse(payload);

    if (parsed.success) {
      onMessage(parsed.data);
    } else {
      this.logger.error({ issues: parsed.error.issues }, 'invalid positions payload');
    }
  }
}
