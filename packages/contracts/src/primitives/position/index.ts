import type { Vector3 } from '@pollo/geometry'
import { z } from 'zod'

/**
 * Where something is, on the wire.
 *
 * A primitive rather than part of the graph resource: a position travels on the
 * socket to every client and on the stream from the worker, and none of those
 * paths care that a graph exists.
 */

// `satisfies` rather than an inferred type: the shape is owned by
// `@pollo/geometry`, and this schema's job is to prove a payload matches it.
export const vector3Schema = z
  .object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  })
  .describe('A point in meters.') satisfies z.ZodType<Vector3>

/** A position in both frames: relative to the event origin and absolute (ECEF-like). */
export const positionPairSchema = z
  .object({
    relative: vector3Schema.describe('Offset from the event origin, in meters.'),
    absolute: vector3Schema.describe('Earth-centered coordinate, in meters.'),
  })
  .describe('The same point expressed in both frames.')

export type PositionPair = z.infer<typeof positionPairSchema>

/**
 * `uncorrected` comes straight from reported GPS locations; `simulated` is what
 * the worker's least-squares reconstruction made of the distance graph.
 */
export const positionSchema = z
  .object({
    uncorrected: positionPairSchema.describe('Straight from the reported GPS location.'),
    simulated: positionPairSchema.describe(
      'Least-squares reconstruction from the distance graph — this is what clients render.',
    ),
  })
  .describe('Where a pixel sits, before and after the simulation.')

export type NodePosition = z.infer<typeof positionSchema>
