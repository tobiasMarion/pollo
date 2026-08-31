import { Csr, estimateScale, guttman, type Origin, Relaxation, type Scale } from '@pollo/geometry'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env/index.js'
import type { Logger } from '../config/logger/index.js'
import { LiveEvent } from '../events/live-event/index.js'
import { EventRegistry } from '../events/registry/index.js'
import { EventGraph } from '../ingest/graph/index.js'
import { PublishLedger } from '../publish/ledger/index.js'
import { PositionPublisher } from '../redis/publisher/index.js'
import { StreamReader } from '../redis/reader/index.js'
import { Solver } from '../solve/solver/index.js'

/**
 * Where the sensor estimate starts before it has seen anything.
 *
 * Deliberately not tuned to any particular radio, and deliberately not an
 * environment variable: it is replaced within a few ticks by what the residuals
 * actually say, and its only job is to make the first sweeps sane. Getting it
 * wrong costs a second of convergence, not accuracy.
 */
const INITIAL_SCALE: Scale = { floor: 0.1, relative: 0.05 }

/**
 * The one place in the worker where anything is constructed.
 *
 * Everything below here is handed what it uses. That is not ceremony: the solver
 * takes the sweep as a function, so its orchestration can be driven by a sweep
 * that does something known, and the registry takes a factory, so it never has
 * to learn what an event is made of in order to keep a map of them.
 */
export function createRegistry(env: Env, logger: Logger, redis: Redis) {
  const publisher = new PositionPublisher(redis, logger, {
    maxlen: env.WORKER_POSITIONS_MAXLEN,
    pointsPerMessage: env.WORKER_POINTS_PER_MESSAGE,
  })

  return new EventRegistry({
    reader: new StreamReader(redis, logger),
    logger,
    tickMs: env.WORKER_TICK_MS,
    createEvent: (eventId, origin) => createEvent(env, publisher, eventId, origin),
  })
}

function createEvent(env: Env, publisher: PositionPublisher, eventId: string, origin: Origin) {
  const solver = new Solver(
    {
      index: new Csr(),
      mean: new Relaxation({ alphaMin: env.WORKER_ALPHA_MIN }),
      sweep: guttman,
      fitScale: estimateScale,
    },
    {
      anchorScale: env.WORKER_ANCHOR_SCALE,
      huberKnee: env.WORKER_HUBER_KNEE,
      sweepsPerTick: env.WORKER_SWEEPS_PER_TICK,
      convergenceM: env.WORKER_CONVERGENCE_M,
      omega: env.WORKER_OMEGA,
      samplingStride: env.WORKER_SAMPLING_STRIDE,
      scaleBlend: env.WORKER_SCALE_BLEND,
      initialScale: INITIAL_SCALE,
    },
  )

  return new LiveEvent(
    {
      graph: new EventGraph(origin),
      ledger: new PublishLedger(env.WORKER_PUBLISH_EPSILON_M),
      solver,
      publisher,
    },
    {
      eventId,
      origin,
      keyframeTicks: env.WORKER_KEYFRAME_TICKS,
      minDegree: env.WORKER_MIN_DEGREE,
    },
  )
}
