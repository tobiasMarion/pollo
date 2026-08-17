import { z } from 'zod'

/**
 * The worker shares the repo's single `.env` with the API but wants almost none
 * of it: no database, no JWT, no OAuth. Validating only what it uses is the
 * difference between a worker that refuses to boot without a GitHub client
 * secret and one that needs a Redis address.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_URL: z.string().min(1),

  /**
   * How often a live event is solved and published. The ingest window is 250 ms,
   * so a faster tick is not about seeing more data — it is about spending more
   * iterations on the data already in.
   */
  WORKER_TICK_MS: z.coerce.number().int().positive().default(33),

  /**
   * Entries kept on each positions stream. The API reads it live and nobody
   * replays it, so this only has to cover a consumer that blinked. Unbounded is
   * how a load test takes Redis down.
   */
  WORKER_POSITIONS_MAXLEN: z.coerce.number().int().positive().default(1_000),

  /** Points per `XADD`. A keyframe of fifty thousand pixels is not one message. */
  WORKER_POINTS_PER_MESSAGE: z.coerce.number().int().positive().default(500),

  /** Ticks between full keyframes — the reconciliation that makes deltas safe to lose. */
  WORKER_KEYFRAME_TICKS: z.coerce.number().int().positive().default(90),

  /** Meters a pixel must move before a delta is worth sending. */
  WORKER_PUBLISH_EPSILON_M: z.coerce.number().nonnegative().default(0.05),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(`Invalid environment variables:\n${issues}`)
  }

  return result.data
}
