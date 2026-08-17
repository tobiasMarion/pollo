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

  /**
   * Sweeps a tick may spend, and the movement below which it gives the rest of
   * the tick back. A settled crowd costs one sweep; the budget is for a crowd
   * that is still arriving.
   */
  WORKER_SWEEPS_PER_TICK: z.coerce.number().int().positive().default(8),
  WORKER_CONVERGENCE_M: z.coerce.number().positive().default(0.002),

  /** Over-relaxation of each update. Past 1.9 the sweep degrades. */
  WORKER_OMEGA: z.coerce.number().min(1).max(1.95).default(1.5),

  /**
   * Floor under the running mean's step. It sets how much averaging there is
   * (over `1 / this` windows) and how fast somebody who walks is followed, which
   * are the same number because they are the same mechanism.
   */
  WORKER_ALPHA_MIN: z.coerce.number().positive().max(1).default(0.2),

  /** Where the robust loss bends, in sigmas. */
  WORKER_HUBER_KNEE: z.coerce.number().positive().default(2),

  /**
   * Global trust in GPS. Anchors assume independent error and GNSS error is
   * shared across a crowd; this is the dial that answers for it.
   */
  WORKER_ANCHOR_SCALE: z.coerce.number().positive().default(1),

  /**
   * Measured distances a device needs before the worker will claim to have
   * placed it. Below this its position is its own GPS reading wearing a
   * reconstruction's clothes, and the panel is right to keep drawing it as an
   * outline.
   */
  WORKER_MIN_DEGREE: z.coerce.number().int().nonnegative().default(2),
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
