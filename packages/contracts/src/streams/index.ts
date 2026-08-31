import { z } from 'zod'
import { locationSchema } from '../primitives/location/index.js'
import { positionSchema } from '../primitives/position/index.js'
import { unionFrom } from '../primitives/union/index.js'

/**
 * Wire contracts carried over Redis Streams between the API (IO) and the
 * position worker (reconstruction). Each stream entry stores the whole message
 * serialized as JSON under the `data` field (see STREAM_FIELD), so anything that
 * can read JSON can sit on either end.
 *
 * Golden rule: NO brightness/effect data crosses this boundary — positions only.
 */

export const ingestMessageSchemas = {
  JOIN: z.object({
    op: z.literal('JOIN'),
    deviceId: z.string(),
    location: locationSchema,
  }),
  LOCATION_UPDATE: z.object({
    op: z.literal('LOCATION_UPDATE'),
    deviceId: z.string(),
    location: locationSchema,
  }),
  DISTANCE: z.object({
    op: z.literal('DISTANCE'),
    from: z.string(),
    to: z.string(),
    // null => the edge must be removed (out of range)
    distance: z.number().nullable(),
  }),
  LEAVE: z.object({
    op: z.literal('LEAVE'),
    deviceId: z.string(),
  }),
} as const

export const ingestMessageSchema = unionFrom('op', ingestMessageSchemas)

export type IngestMessage = z.infer<typeof ingestMessageSchema>

/**
 * One stream entry carries a window's worth of mutations rather than one each.
 * An entry per mutation is an XADD per message the crowd sends, and the ops here
 * are already coalesced by device and by pair — two readings from one phone in
 * the same window have one useful outcome between them.
 */
export const ingestBatchSchema = z.object({
  at: z.number().describe('Server clock when the window was cut, in milliseconds.'),
  ops: z.array(ingestMessageSchema),
})

export type IngestBatch = z.infer<typeof ingestBatchSchema>
export type IngestOp = IngestMessage['op']
export const ingestOps = Object.keys(ingestMessageSchemas) as [IngestOp, ...IngestOp[]]

export const positionPointSchema = z.object({
  deviceId: z.string(),
  position: positionSchema,
})

export type PositionPoint = z.infer<typeof positionPointSchema>

/**
 * `delta`    -> only the pixels whose position settled/changed since last send.
 * `keyframe` -> full state, periodic, for late joiners and against drift.
 */
export const positionsMessageSchema = z.object({
  kind: z.enum(['delta', 'keyframe']),
  points: z.array(positionPointSchema),
})

export type PositionsMessage = z.infer<typeof positionsMessageSchema>

export const controlMessageSchemas = {
  EVENT_OPENED: z.object({
    op: z.literal('EVENT_OPENED'),
    eventId: z.string().uuid(),
    // exact event location (baseLocation for the reconstruction)
    latitude: z.number(),
    longitude: z.number(),
  }),
  EVENT_CLOSED: z.object({
    op: z.literal('EVENT_CLOSED'),
    eventId: z.string().uuid(),
  }),
} as const

export const controlMessageSchema = unionFrom('op', controlMessageSchemas)

export type ControlMessage = z.infer<typeof controlMessageSchema>
export type ControlOp = ControlMessage['op']
export const controlOps = Object.keys(controlMessageSchemas) as [ControlOp, ...ControlOp[]]

/** Single field where the JSON payload is stored in each stream entry. */
export const STREAM_FIELD = 'data'

export const streamKeys = {
  /** Graph mutations, API -> worker, per event. */
  ingest: (eventId: string) => `event:${eventId}:ingest`,
  /** Position updates, worker -> API, per event. */
  positions: (eventId: string) => `event:${eventId}:positions`,
  /** Authoritative position snapshot, written by the worker. */
  snapshot: (eventId: string) => `event:${eventId}:snapshot`,
  /** Global event lifecycle channel, API -> worker. */
  control: () => 'events:control',
} as const
