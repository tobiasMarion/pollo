import { z } from 'zod';
import { effectSchema } from '../effects/schemas.js';
import { positionSchema } from '../graph.js';
import { locationSchema } from '../location.js';
import { unionFrom } from '../union.js';

/**
 * Every frame that crosses a Pollo socket, keyed by its own `type` so the union
 * below, the message-type list and the per-direction subsets in `directions.ts`
 * all derive from this one record.
 *
 * Reports are the admin's view of a device-facing frame: same payload plus the
 * `deviceId` the device itself has no need to be told.
 */
export const messageSchemas = {
  AUTHENTICATION: z
    .object({
      type: z.literal('AUTHENTICATION'),
      token: z.string().describe('The admin JWT — a header is not an option on upgrade.'),
    })
    .describe('First frame of an admin socket.'),

  // Sent by the server once the admin socket is authenticated. Without it the
  // client has no way to know when it is safe to rely on report messages.
  AUTHENTICATION_ACK: z
    .object({
      type: z.literal('AUTHENTICATION_ACK'),
    })
    .describe('The admin socket is authenticated; reports start flowing.'),

  JOIN: z
    .object({
      type: z.literal('JOIN'),
      deviceId: z.string().describe('Identifier the device picks for itself.'),
      location: locationSchema,
    })
    .describe('First frame of a device socket.'),

  LOCATION_UPDATE: z
    .object({
      type: z.literal('LOCATION_UPDATE'),
      location: locationSchema,
    })
    .describe('A device reporting that it moved.'),

  LOCATION_UPDATE_REPORT: z
    .object({
      type: z.literal('LOCATION_UPDATE_REPORT'),
      deviceId: z.string(),
      location: locationSchema,
    })
    .describe('A `LOCATION_UPDATE`, as the admin sees it.'),

  USER_JOINED: z
    .object({
      type: z.literal('USER_JOINED'),
      deviceId: z.string(),
      location: locationSchema,
    })
    .describe('A device joined the event.'),

  DISTANCE: z
    .object({
      type: z.literal('DISTANCE'),
      to: z.string().describe('The device that was measured.'),
      distance: z.number().nullable().describe('Meters, or null when the peer went out of range.'),
    })
    .describe('A device reporting how far a peer is.'),

  DISTANCE_REPORT: z
    .object({
      type: z.literal('DISTANCE_REPORT'),
      from: z.string().describe('The device that measured.'),
      to: z.string().describe('The device that was measured.'),
      distance: z.number().nullable().describe('Meters, or null to drop the edge.'),
    })
    .describe('A `DISTANCE`, as the admin sees it.'),

  USER_LEFT: z
    .object({
      type: z.literal('USER_LEFT'),
      deviceId: z.string(),
    })
    .describe('A device disconnected.'),

  SET_POINT: z
    .object({
      type: z.literal('SET_POINT'),
      position: positionSchema,
    })
    .describe('Where the worker placed this device — sent to that device alone.'),

  SET_POINT_REPORT: z
    .object({
      type: z.literal('SET_POINT_REPORT'),
      deviceId: z.string(),
      position: positionSchema,
    })
    .describe('A `SET_POINT`, as the admin sees it.'),

  EFFECT: z
    .object({
      type: z.literal('EFFECT'),
      effect: effectSchema,
    })
    .describe('A cue, fired by the admin and relayed untouched to every device.'),
} as const;

export const messageSchema = unionFrom('type', messageSchemas);

export type Message = z.infer<typeof messageSchema>;
export type MessageType = Message['type'];

/** One member of the union, picked by type. */
export type MessageOf<Type extends MessageType> = Extract<Message, { type: Type }>;

export const messageTypes = Object.keys(messageSchemas) as [MessageType, ...MessageType[]];
