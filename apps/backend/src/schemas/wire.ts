import { z } from 'zod';
import { positionSchema } from './graph.js';
import { locationSchema } from './location.js';

/**
 * Wire contracts carried over Redis Streams between the Node API (IO) and the
 * Rust worker (simulation). Each stream entry stores the whole message
 * serialized as JSON under the `data` field (see STREAM_FIELD), so the same
 * shape can be mirrored with serde on the Rust side.
 *
 * Golden rule: NO brightness/effect data crosses this boundary — positions only.
 */

export const ingestMessageSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('JOIN'),
    deviceId: z.string(),
    location: locationSchema,
  }),
  z.object({
    op: z.literal('LOCATION_UPDATE'),
    deviceId: z.string(),
    location: locationSchema,
  }),
  z.object({
    op: z.literal('DISTANCE'),
    from: z.string(),
    to: z.string(),
    // null => the edge must be removed (out of range)
    distance: z.number().nullable(),
  }),
  z.object({
    op: z.literal('LEAVE'),
    deviceId: z.string(),
  }),
]);

export type IngestMessage = z.infer<typeof ingestMessageSchema>;

export const positionPointSchema = z.object({
  deviceId: z.string(),
  position: positionSchema,
});

export type PositionPoint = z.infer<typeof positionPointSchema>;

/**
 * `delta`    -> only the pixels whose position settled/changed since last send.
 * `keyframe` -> full state, periodic, for late joiners and against drift.
 */
export const positionsMessageSchema = z.object({
  kind: z.enum(['delta', 'keyframe']),
  points: z.array(positionPointSchema),
});

export type PositionsMessage = z.infer<typeof positionsMessageSchema>;

export const controlMessageSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('EVENT_OPENED'),
    eventId: z.string().uuid(),
    // exact event location (baseLocation for the reconstruction)
    latitude: z.number(),
    longitude: z.number(),
  }),
  z.object({
    op: z.literal('EVENT_CLOSED'),
    eventId: z.string().uuid(),
  }),
]);

export type ControlMessage = z.infer<typeof controlMessageSchema>;

/** Single field where the JSON payload is stored in each stream entry. */
export const STREAM_FIELD = 'data';

export const streamKeys = {
  /** Graph mutations, Node -> Rust, per event. */
  ingest: (eventId: string) => `event:${eventId}:ingest`,
  /** Position updates, Rust -> Node, per event. */
  positions: (eventId: string) => `event:${eventId}:positions`,
  /** Authoritative position snapshot, written by the worker. */
  snapshot: (eventId: string) => `event:${eventId}:snapshot`,
  /** Global event lifecycle channel, Node -> Rust. */
  control: () => 'events:control',
} as const;
