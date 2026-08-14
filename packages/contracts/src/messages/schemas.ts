import { z } from 'zod'
import { effectSchema } from '../effects/schemas.js'
import { positionSchema } from '../graph.js'
import { locationSchema } from '../location.js'
import { unionFrom } from '../union.js'

/**
 * Every frame that crosses a Pollo socket, keyed by its own `type` so the union
 * below, the message-type list and the per-direction subsets in `directions.ts`
 * all derive from this one record.
 *
 * The two directions are shaped by what each end is doing. A device is told
 * about single things as they happen, because it acts on each one. The admin
 * panel is drawing a field rather than following an event log, so it is sent
 * `FIELD_UPDATE`: one coalesced batch on a fixed cadence, whatever the crowd
 * did in between.
 *
 * Neither end is told who joined or left. A device is handed `SET_NEIGHBORS`
 * instead — the peers it should measure — which is the only thing it ever did
 * with an arrival, and costs a frame per device rather than a frame per device
 * per arrival.
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

  FIELD_UPDATE: z
    .object({
      type: z.literal('FIELD_UPDATE'),
      at: z
        .number()
        .describe('Server clock when the batch was cut, in milliseconds since the epoch.'),
      window: z
        .number()
        .describe('Milliseconds until the next batch — how long a client has to animate across.'),
      locations: z
        .array(z.object({ deviceId: z.string(), location: locationSchema }))
        .describe('Devices that joined or moved. One entry each, carrying their latest reading.'),
      placed: z
        .array(z.object({ deviceId: z.string(), position: positionSchema }))
        .describe('Devices the worker has put somewhere since the last batch.'),
      left: z.array(z.string()).describe('Device ids that disconnected.'),
      edges: z
        .array(
          z.object({
            from: z.string(),
            to: z.string(),
            distance: z.number().nullable().describe('Meters, or null to drop the edge.'),
          }),
        )
        .describe(
          'Distances that changed. One entry per pair, carrying the latest value, and never naming a device this batch also reports in `left`.',
        ),
    })
    .describe('Everything that happened to the field since the last batch, coalesced.'),

  DISTANCES: z
    .object({
      type: z.literal('DISTANCES'),
      measurements: z
        .array(
          z.object({
            to: z.string().describe('The device that was measured.'),
            distance: z
              .number()
              .nullable()
              .describe('Meters, or null to retract an edge that no longer holds.'),
          }),
        )
        .describe('One sweep. Peers that were not reached are simply absent.'),
    })
    .describe('A device reporting how far its assigned peers are — one frame per sweep.'),

  SET_POINT: z
    .object({
      type: z.literal('SET_POINT'),
      position: positionSchema,
    })
    .describe('Where the worker placed this device — sent to that device alone.'),

  SET_NEIGHBORS: z
    .object({
      type: z.literal('SET_NEIGHBORS'),
      peers: z
        .array(z.string())
        .describe('Device ids to range against. Replaces the previous list outright.'),
    })
    .describe('Which peers this device should measure, decided by the server.'),

  EFFECT: z
    .object({
      type: z.literal('EFFECT'),
      effect: effectSchema,
    })
    .describe('A cue, fired by the admin and relayed untouched to every device.'),
} as const

export const messageSchema = unionFrom('type', messageSchemas)

export type Message = z.infer<typeof messageSchema>
export type MessageType = Message['type']

/** One member of the union, picked by type. */
export type MessageOf<Type extends MessageType> = Extract<Message, { type: Type }>

export const messageTypes = Object.keys(messageSchemas) as [MessageType, ...MessageType[]]

/** One entry of a `DISTANCES` sweep. */
export type Measurement = MessageOf<'DISTANCES'>['measurements'][number]
